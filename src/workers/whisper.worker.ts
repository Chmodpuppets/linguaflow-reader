/// <reference lib="webworker" />
/**
 * Whisper 转写 worker。
 *
 * 放 worker 里做的原因：模型推理是纯 CPU 密集的，跑在主线程会让录音波形、
 * 打字、按钮全部卡死。这里只负责「加载模型 + 转写」，音频重采样在主线程完成。
 */
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import type { TimedChunk } from '../lib/whisperTypes';

type InitRequest = { id: number; type: 'init'; model: string; source: WhisperSource };
type TranscribeRequest = { id: number; type: 'transcribe'; audio: Float32Array; model?: string; source?: WhisperSource };
// 书本原音对齐用：返回 segment 级时间戳，offset 是该分片在整条音频里的起点（秒）。
type TranscribeTimedRequest = { id: number; type: 'transcribe-timed'; audio: Float32Array; offset: number; model?: string; source?: WhisperSource };
type Request = InitRequest | TranscribeRequest | TranscribeTimedRequest;

type WhisperSource = 'mirror' | 'official' | 'local';

type Reply =
  | { id: number; type: 'progress'; phase: 'download' | 'ready'; progress: number; label: string }
  | { id: number; type: 'result'; text: string }
  | { id: number; type: 'segments'; chunks: TimedChunk[] }
  | { id: number; type: 'error'; message: string };

const DEFAULT_MODEL = 'Xenova/whisper-tiny.en';

let cachedModel = '';
let cachedSource: WhisperSource | '' = '';
let cachedPipeline: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
let reportingId = 0;

function post(reply: Reply) {
  self.postMessage(reply);
}

function configureRuntime(source: WhisperSource) {
  // 不读本地 models 目录，全部走后端下载 + 浏览器 Cache API
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  if (source === 'local') {
    // 自托管：同源 /models/<org>/<repo>/...，路径模板要去掉 HF 的 resolve 段
    env.remoteHost = `${self.location.origin}/models/`;
    env.remotePathTemplate = '{model}/';
  } else {
    env.remoteHost = source === 'official' ? 'https://huggingface.co/' : 'https://hf-mirror.com/';
    env.remotePathTemplate = '{model}/resolve/{revision}/';
  }
  // 没有 COOP/COEP 头就没有 SharedArrayBuffer，多线程会直接报错，锁 1 线程最稳
  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    wasm.numThreads = 1;
    // 默认会去 jsDelivr 拉 ORT 运行时，深圳直连 SSL 失败；这里换成自托管的同源文件
    wasm.wasmPaths = { mjs: '/wasm/ort-wasm-simd-threaded.mjs', wasm: '/wasm/ort-wasm-simd-threaded.wasm' };
  }
}

async function getPipeline(model: string, source: WhisperSource): Promise<AutomaticSpeechRecognitionPipeline> {
  if (cachedPipeline && cachedModel === model && cachedSource === source) return cachedPipeline;
  cachedModel = model;
  cachedSource = source;
  configureRuntime(source);
  cachedPipeline = pipeline('automatic-speech-recognition', model, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (event: { status?: string; progress?: number; loaded?: number; total?: number; file?: string }) => {
      if (event.status === 'progress' && typeof event.progress === 'number') {
        post({ id: reportingId, type: 'progress', phase: 'download', progress: Math.round(event.progress), label: event.file || '模型分片下载中' });
      }
    },
  }) as Promise<AutomaticSpeechRecognitionPipeline>;
  cachedPipeline.catch(() => { cachedPipeline = null; cachedModel = ''; cachedSource = ''; });
  return cachedPipeline;
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  reportingId = request.id;
  try {
    if (request.type === 'init') {
      const model = request.model || DEFAULT_MODEL;
      await getPipeline(model, request.source);
      post({ id: request.id, type: 'progress', phase: 'ready', progress: 100, label: '模型已就绪' });
      // init 也要给一个终态，否则主线程 warmupWhisper() 的 Promise 永远不 resolve。
      post({ id: request.id, type: 'result', text: '' });
      return;
    }
    if (request.type === 'transcribe') {
      const recognizer = await getPipeline(request.model || cachedModel || DEFAULT_MODEL, request.source || 'mirror');
      const audio = request.audio;
      if (!audio?.length) throw new Error('音频为空，无法转写');
      const output = await recognizer(audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false,
      });
      const text = Array.isArray(output) ? output.map((item) => item.text).join(' ') : output.text;
      post({ id: request.id, type: 'result', text: String(text || '').trim() });
      return;
    }
    if (request.type === 'transcribe-timed') {
      const recognizer = await getPipeline(request.model || cachedModel || DEFAULT_MODEL, request.source || 'mirror');
      const audio = request.audio;
      if (!audio?.length) { post({ id: request.id, type: 'segments', chunks: [] }); return; }
      const output = await recognizer(audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: true,
      }) as { chunks?: { timestamp: (number | null)[]; text: string }[] };
      const offset = Number(request.offset) || 0;
      const chunks: TimedChunk[] = (output.chunks || []).map((chunk) => {
        const start = Number(chunk.timestamp?.[0] ?? 0) + offset;
        const rawEnd = chunk.timestamp?.[1];
        const end = (typeof rawEnd === 'number' ? rawEnd : start - offset) + offset;
        return { start, end: Math.max(end, start + 0.2), text: String(chunk.text || '').trim() };
      }).filter((chunk) => chunk.text.length > 0);
      post({ id: request.id, type: 'segments', chunks });
    }
  } catch (error) {
    post({ id: request.id, type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

export {};
