/**
 * 本地 Whisper 转写的门面层。
 *
 * 职责边界：
 *  - 主线程：把 MediaRecorder 的 webm/opus 解码 → 降混单声道 → 重采样 16kHz（Whisper 只吃这个）
 *  - Worker：加载 onnx 模型并推理，避免阻塞录音波形与 UI
 *
 * 全流程离线可用：模型走浏览器 Cache API，ORT 运行时走自托管的 /wasm/。
 */

import type { TimedChunk } from './whisperTypes';

export type WhisperModelId = 'Xenova/whisper-tiny.en' | 'Xenova/whisper-base.en';

export interface WhisperModelOption {
  id: WhisperModelId;
  name: string;
  note: string;
  size: string;
}

export const WHISPER_MODELS: WhisperModelOption[] = [
  { id: 'Xenova/whisper-tiny.en', name: 'Whisper Tiny', note: '最快，适合逐句跟读', size: '约 40MB' },
  { id: 'Xenova/whisper-base.en', name: 'Whisper Base', note: '更准，自由表达更稳', size: '约 80MB' },
];

export const DEFAULT_WHISPER_MODEL: WhisperModelId = 'Xenova/whisper-tiny.en';

export type WhisperPhase = 'idle' | 'download' | 'ready' | 'transcribing' | 'done' | 'error';

export interface WhisperProgress {
  phase: WhisperPhase;
  progress: number;
  label: string;
}

type Pending = {
  // 同一个 worker 同时服务「纯文本转写」和「带时间戳分段」，结果类型不同。
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: WhisperProgress) => void;
};

const pending = new Map<number, Pending>();
let worker: Worker | null = null;
let sequence = 0;
let loadedModel = '';

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/whisper.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<{ id: number; type: 'progress' | 'result' | 'segments' | 'error'; phase?: 'download' | 'ready'; progress?: number; label?: string; text?: string; chunks?: TimedChunk[]; message?: string }>) => {
    const message = event.data;
    const task = pending.get(message.id);
    if (!task) return;
    if (message.type === 'progress') {
      if (message.phase === 'ready') loadedModel = 'ready';
      task.onProgress?.({
        phase: message.phase === 'ready' ? 'ready' : 'download',
        progress: message.progress ?? 0,
        label: message.label ?? '',
      });
      return;
    }
    pending.delete(message.id);
    if (message.type === 'error') task.reject(new Error(message.message || 'Whisper 转写失败'));
    else if (message.type === 'segments') task.resolve(message.chunks || []);
    else task.resolve(message.text || '');
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || 'Whisper worker 启动失败');
    const failed = worker;
    // worker 脚本级崩溃后实例不可复用：置空引用并 terminate，
    // 下次 transcribe 会由 ensureWorker() 重新创建，模型缓存也随之重建。
    // 不清空的话，后续所有请求都会继续打到这个坏 worker 上。
    worker = null;
    loadedModel = '';
    void failed?.terminate();
    pending.forEach((task) => task.reject(error));
    pending.clear();
  };
  return worker;
}

export function isWhisperSupported(): boolean {
  return typeof Worker !== 'undefined' && typeof WebAssembly === 'object' && typeof OfflineAudioContext !== 'undefined';
}

export function isWhisperLoaded(): boolean {
  return loadedModel === 'ready';
}

/**
 * 模型来源：
 *  - mirror   hf-mirror.com，深圳直连可用的镜像（默认）
 *  - official huggingface.co，海外网络用
 *  - local    同源 /models/，自托管/内网部署用，可完全离线
 */
export type WhisperSource = 'mirror' | 'official' | 'local';

const SOURCE_KEY = 'lf-whisper-source';

export function whisperSource(): WhisperSource {
  // 存储被禁用（阻止所有 Cookie 等）时 localStorage 直接抛错；降级为默认源。
  try {
    const stored = localStorage.getItem(SOURCE_KEY) as WhisperSource | null;
    return stored === 'official' || stored === 'local' ? stored : 'mirror';
  } catch {
    return 'mirror';
  }
}

export function setWhisperSource(source: WhisperSource): void {
  try { localStorage.setItem(SOURCE_KEY, source); } catch { /* 仅本次会话内生效 */ }
}

export const WHISPER_SOURCE_LABEL: Record<WhisperSource, string> = {
  mirror: '镜像 hf-mirror',
  official: '官方 huggingface',
  local: '本机 /models',
};

/** 预下载模型：用户点「启用 Whisper」时先跑，避免录完音才等 40MB。 */
export function warmupWhisper(model: WhisperModelId = DEFAULT_WHISPER_MODEL, onProgress?: (progress: WhisperProgress) => void): Promise<string> {
  return run({ type: 'init', model, source: whisperSource() }, onProgress);
}

export function transcribeWithWhisper(blob: Blob, model: WhisperModelId = DEFAULT_WHISPER_MODEL, onProgress?: (progress: WhisperProgress) => void): Promise<string> {
  return (async () => {
    const audio = await decodeToMono16k(blob);
    onProgress?.({ phase: 'transcribing', progress: 0, label: `识别 ${(audio.length / 16000).toFixed(1)} 秒音频` });
    const text = await run({ type: 'transcribe', audio, model, source: whisperSource() }, (progress) => {
      // 模型加载阶段的进度透传；进入推理后不再有百分比，交给上层显示“识别中”
      if (progress.phase === 'download' || progress.phase === 'ready') onProgress?.(progress);
      else onProgress?.({ phase: 'transcribing', progress: 0, label: progress.label });
    }, [audio.buffer]);
    onProgress?.({ phase: 'done', progress: 100, label: '转写完成' });
    return text;
  })();
}

function run<R = string>(payload: Record<string, unknown>, onProgress?: (progress: WhisperProgress) => void, transfer: Transferable[] = []): Promise<R> {
  const client = ensureWorker();
  const id = ++sequence;
  return new Promise<R>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, onProgress });
    try {
      client.postMessage({ ...payload, id }, transfer);
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * 解码成 Whisper 要求的 16kHz 单声道 Float32。
 * 浏览器录音一般是 44.1/48kHz 双声道，直接喂给模型会有明显的音高/语速错位。
 */
export async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const buffer = await blob.arrayBuffer();
  const context = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(buffer);
  } finally {
    if (context.state !== 'closed') void context.close().catch(() => undefined);
  }
  const targetRate = 16000;
  if (decoded.sampleRate === targetRate && decoded.numberOfChannels === 1) return decoded.getChannelData(0).slice();
  const frames = Math.max(1, Math.ceil(decoded.duration * targetRate));
  const offline = new OfflineAudioContext(1, frames, targetRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}

async function decodeWithContext(buffer: ArrayBuffer): Promise<AudioBuffer> {
  let context: AudioContext;
  try {
    // 直接让解码器输出 16kHz，避免先解出 44.1/48kHz 立体声再重采样造成的数倍内存峰值。
    context = new AudioContext({ sampleRate: 16000 });
  } catch {
    // 旧 Safari 会忽略/拒绝自定义 sampleRate，退回设备采样率后由 OfflineAudioContext 重采样。
    context = new AudioContext();
  }
  try { return await context.decodeAudioData(buffer); }
  finally { if (context.state !== 'closed') void context.close().catch(() => undefined); }
}

/**
 * 书本原音对齐专用的低内存解码，输出 16kHz 单声道 PCM。
 * 之后按样本窗切片（见 bookAlignment.ts）—— PCM 切片是精确的，不需要按字节猜 mp3 帧边界。
 */
export async function decodeBookAudioToMono16k(blob: Blob): Promise<Float32Array> {
  const decoded = await decodeWithContext(await blob.arrayBuffer());
  const targetRate = 16000;
  if (decoded.sampleRate !== targetRate) {
    const frames = Math.max(1, Math.ceil(decoded.duration * targetRate));
    const offline = new OfflineAudioContext(1, frames, targetRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0).slice();
  }
  const left = decoded.getChannelData(0);
  if (decoded.numberOfChannels === 1) return left.slice();
  const right = decoded.getChannelData(1);
  const mono = new Float32Array(left.length);
  for (let i = 0; i < left.length; i += 1) mono[i] = (left[i] + right[i]) * 0.5;
  return mono;
}

/** 带 segment 时间戳的转写；audio 是独立 PCM 分片，可安全 transfer 给 worker。 */
export function transcribeTimed(audio: Float32Array, offset: number, model: WhisperModelId = DEFAULT_WHISPER_MODEL, onProgress?: (progress: WhisperProgress) => void): Promise<TimedChunk[]> {
  return run<TimedChunk[]>({ type: 'transcribe-timed', audio, offset, model, source: whisperSource() }, onProgress, [audio.buffer]);
}
