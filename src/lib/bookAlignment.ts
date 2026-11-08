import type { Book } from '../types';
import type { TimedChunk } from './whisperTypes';
import { decodeBookAudioToMono16k, transcribeTimed, type WhisperModelId, type WhisperProgress } from './whisper';

/**
 * 「上传自己的原音 → 句级定位」的纯前端运行时链路。
 *
 * 流程：解码成 16kHz 单声道 PCM → 按 60s 样本窗切片 → 本地 Whisper 带时间戳转写
 * → 与书的正文行做单调锚点对齐 → 结果按 bookId 存 IndexedDB（见 db.ts）。
 *
 * 全程无后端、无闭源 API、无音频外传；模型与 ORT 运行时沿用项目已有的本地方案。
 *
 * 内存策略：解码时直接让 AudioContext 输出 16kHz（而不是 44.1/48kHz 立体声再重采样），
 * 峰值降到约 1/3；切片发生在 PCM 上，按样本数切是精确的，不需要按字节猜 mp3 帧边界。
 */

/** 浏览器内一次性解码的上限。16MB ≈ 16 分钟 @128kbps，再长会明显吃内存且 wasm 推理过久。 */
export const MAX_ALIGN_BYTES = 16 * 1024 * 1024;
export const ALIGN_WINDOW_SECONDS = 60;

export interface AlignedLine { t: string; s: number; e: number }

export interface BookAlignment {
  version: 1;
  bookId: string;
  createdAt: string;
  /** 音频总时长（秒） */
  duration: number;
  lineCount: number;
  lines: AlignedLine[];
}

export type AlignPhase = 'decode' | 'model' | 'transcribe' | 'align' | 'save' | 'done';
export interface AlignProgress { phase: AlignPhase; progress: number; label: string }

export class AlignmentCancelled extends Error {
  constructor() { super('已取消'); this.name = 'AlignmentCancelled'; }
}

export interface BuildAlignmentOptions {
  onProgress?: (progress: AlignProgress) => void;
  isCancelled?: () => boolean;
  model?: WhisperModelId;
}

const norm = (text: string): string[] => text.toLowerCase().match(/[a-z0-9']+/g) || [];

function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const word of a) if (b.has(word)) inter += 1;
  return inter / Math.max(a.size, b.size);
}

/** 按书顺序收集可做跟读目标的正文行；滤掉插画页、页码与词数太少的气泡词。 */
export function collectBookLines(book: Book): string[] {
  const lines: string[] = [];
  for (const chapter of book.chapters) {
    for (const paragraph of chapter.paragraphs) {
      const text = paragraph.trim().replace(/\s+/g, ' ');
      // 词重叠率对齐至少需要几个实词才有区分度；按词数过滤比按字符数准。
      if (text.length >= 15 && norm(text).length >= 5) lines.push(text);
    }
  }
  return lines;
}

/**
 * Whisper segment ↔ 书文本行的单调对齐。
 *
 * 用「锚点 + 插值」而不是 O(n·m) 全表 DP：每行只在后续一个滚动窗口内找最佳 segment，
 * 命中且词重叠率达标才作为锚点；锚点之间的行按字数比例线性分配时间。
 * 这样对 OCR 误差、Whisper 专名偏差、段落跨多个 segment 都有容错，且 3000 行也不会卡住主线程。
 */
export function alignSegmentsToLines(lines: string[], chunks: TimedChunk[]): AlignedLine[] {
  if (lines.length < 3 || chunks.length < 3) return [];
  const lineSets = lines.map((line) => new Set(norm(line)));
  const chunkSets = chunks.map((chunk) => new Set(norm(chunk.text)));

  const anchors: { li: number; ci: number }[] = [];
  let cursor = 0;
  const WINDOW = 80;
  for (let li = 0; li < lines.length; li += 1) {
    if (!lineSets[li].size) continue;
    let bestCi = -1;
    let bestScore = 0;
    const end = Math.min(chunks.length, Math.max(cursor + 1, cursor + WINDOW));
    for (let ci = cursor; ci < end; ci += 1) {
      const score = similarity(lineSets[li], chunkSets[ci]);
      if (score > bestScore) { bestScore = score; bestCi = ci; }
    }
    if (bestCi >= 0 && bestScore >= 0.42) {
      anchors.push({ li, ci: bestCi });
      // 单调不减（不 +1），允许相邻行命中同一个 segment 或紧邻的 segment。
      cursor = Math.max(cursor, bestCi);
    }
  }
  // 两个可靠锚点就足以给短音频做定位；门槛放到 3 会让 1–2 分钟的章节直接放弃。
  if (anchors.length < 2) return [];

  const times = anchors.map((anchor) => ({
    li: anchor.li,
    s: chunks[anchor.ci].start,
    e: chunks[anchor.ci].end,
  }));
  // 时间单调化：Whisper 的 stride 重叠可能让相邻锚点时间倒退。
  for (let i = 1; i < times.length; i += 1) {
    if (times[i].s < times[i - 1].e) times[i].s = times[i - 1].e;
    if (times[i].e <= times[i].s) times[i].e = times[i].s + 0.25;
  }

  const result: AlignedLine[] = [];
  const push = (li: number, s: number, e: number) => {
    const text = lines[li];
    if (text) result.push({ t: text, s: Math.max(0, s), e: Math.max(s + 0.25, e) });
  };

  for (let i = 0; i < times.length; i += 1) {
    const current = times[i];
    push(current.li, current.s, current.e);
    const next = times[i + 1];
    if (!next || next.li <= current.li + 1 || next.s <= current.e) continue;
    // 两个锚点之间的行按字数比例分配时间，避免整段共用一个时间戳。
    let totalChars = 0;
    for (let li = current.li + 1; li < next.li; li += 1) totalChars += Math.max(1, lines[li].length);
    if (!totalChars) continue;
    const span = next.s - current.e;
    let acc = 0;
    for (let li = current.li + 1; li < next.li; li += 1) {
      const s = current.e + span * (acc / totalChars);
      acc += Math.max(1, lines[li].length);
      const e = current.e + span * (acc / totalChars);
      push(li, s, e);
    }
  }

  // 同文本只保留首次出现：findAudioSpan 按文本查找，重复行没有意义还会放大误匹配。
  const seen = new Set<string>();
  return result.filter((line) => {
    const key = line.t.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function buildBookAlignment(book: Book, blob: Blob, options: BuildAlignmentOptions = {}): Promise<BookAlignment> {
  const { onProgress, isCancelled } = options;
  if (blob.size > MAX_ALIGN_BYTES) {
    throw new Error(`音频 ${(blob.size / 1048576).toFixed(1)}MB 超过 ${MAX_ALIGN_BYTES / 1048576}MB 上限。请剪出要练的章节再试（对齐整本有声书在浏览器里不现实）。`);
  }
  const lines = collectBookLines(book);
  if (lines.length < 3) throw new Error('这本书没有足够的正文文本可供对齐（扫描图片版 EPUB 暂不支持）。');

  onProgress?.({ phase: 'decode', progress: 0, label: '解码音频到 16kHz…' });
  const pcm = await decodeBookAudioToMono16k(blob);
  if (!pcm.length) throw new Error('音频解码为空，换一个 mp3 / m4a / wav 文件试试。');
  const duration = pcm.length / 16000;
  if (isCancelled?.()) throw new AlignmentCancelled();

  const windowSamples = ALIGN_WINDOW_SECONDS * 16000;
  const total = Math.ceil(pcm.length / windowSamples);
  const chunks: TimedChunk[] = [];
  const onWorkerProgress = (progress: WhisperProgress) => {
    if (progress.phase === 'download' || progress.phase === 'ready') {
      onProgress?.({ phase: 'model', progress: progress.progress, label: progress.label || '加载本地模型…' });
    }
  };
  for (let i = 0; i < total; i += 1) {
    if (isCancelled?.()) throw new AlignmentCancelled();
    const from = i * windowSamples;
    const to = Math.min(pcm.length, from + windowSamples);
    const slice = pcm.slice(from, to); // 独立 buffer，可安全 transfer 给 worker
    const parts = await transcribeTimed(slice, from / 16000, options.model, onWorkerProgress);
    for (const part of parts) if (part.start < duration + 1) chunks.push(part);
    onProgress?.({
      phase: 'transcribe',
      progress: Math.round(((i + 1) / total) * 100),
      label: `本地转写 ${i + 1}/${total} 段`,
    });
  }

  if (isCancelled?.()) throw new AlignmentCancelled();
  onProgress?.({ phase: 'align', progress: 0, label: `对齐 ${lines.length} 行文本…` });
  const aligned = alignSegmentsToLines(lines, chunks);
  if (aligned.length < 2) {
    throw new Error(`只对齐到 ${aligned.length} 句。通常是音频与这本书的文本不对应，或音频里几乎没有朗读人声。`);
  }
  return {
    version: 1,
    bookId: book.id,
    createdAt: new Date().toISOString(),
    duration,
    lineCount: aligned.length,
    lines: aligned,
  };
}
