// 有声书句子 → 音频时间戳：**按 bookId 查表**。
//
// 两个来源，运行时对齐优先：
//  1. 用户为自己的音频生成的对齐结果，存 IndexedDB alignment store（见 bookAlignment.ts）
//  2. 内置《Diary of a Wimpy Kid》的预计算表，只作为本机可选 JSON 按需 fetch
//     （同样是书籍正文衍生数据，绝不打进 JS bundle 或随公开仓库分发）
//
// 其它书一律返回 null → 调用方回退整本播放 / TTS，绝不拿别的书的时间轴硬套。

import { getAlignment } from './db';
import type { AlignedLine } from './bookAlignment';

export interface AudioSpan { start: number; end: number }

const WIMPY_KID_ID = 'wimpy-kid-1';
const STATIC_MAP_URL = '/local-content/wimpy-kid-audio-map.json';
const norm = (t: string): string[] => (t.toLowerCase().match(/[a-z0-9']+/g) || []);

/**
 * 内置书的预计算时间戳同样是书籍正文的衍生数据，只作为本机可选 JSON 存在。
 * 404 / 解析失败都返回空数组 → findAudioSpan 自然回退到整段播放。
 */
async function loadStaticAudioMap(): Promise<AlignedLine[]> {
  try {
    const response = await fetch(STATIC_MAP_URL, { cache: 'no-cache' });
    if (!response.ok) return [];
    const data = await response.json() as AlignedLine[];
    if (!Array.isArray(data)) return [];
    return data.filter((line) => typeof line?.t === 'string' && Number.isFinite(line.s) && Number.isFinite(line.e));
  } catch {
    return [];
  }
}

interface IndexedLine { set: Set<string>; s: number; e: number }

/** bookId → 词集合索引。 */
const indexes = new Map<string, IndexedLine[]>();
const loading = new Map<string, Promise<void>>();
/** 区分「用户音频生成的对齐」与「内置书的静态表」——后者不能套在用户自己的音频上。 */
const sources = new Map<string, 'runtime' | 'static'>();

export type AlignmentSource = 'runtime' | 'static' | 'none';
export function alignmentSource(bookId?: string): AlignmentSource {
  return bookId ? sources.get(bookId) || 'none' : 'none';
}

function toIndexed(lines: AlignedLine[]): IndexedLine[] {
  return lines.map((line) => ({ set: new Set(norm(line.t)), s: line.s, e: line.e }));
}

/** 这本书是否可能有对齐数据（内置静态表，或运行时已加载/注册）。 */
export function hasAlignment(bookId?: string): boolean {
  return Boolean(bookId && (bookId === WIMPY_KID_ID || indexes.has(bookId)));
}

/** 按 bookId 加载对齐表；并发去重，没有映射的书零下载零解析。 */
export function loadAlignment(bookId?: string): Promise<void> {
  if (!bookId) return Promise.resolve();
  const inflight = loading.get(bookId);
  if (inflight) return inflight;
  if (indexes.has(bookId)) return Promise.resolve();
  const task = (async () => {
    try {
      const stored = await getAlignment(bookId);
      if (stored?.lines?.length) {
        indexes.set(bookId, toIndexed(stored.lines));
        sources.set(bookId, 'runtime');
        return;
      }
    } catch { /* IndexedDB 不可用时继续回退内置静态表 */ }
    if (bookId !== WIMPY_KID_ID) return;
    const staticLines = await loadStaticAudioMap();
    if (!staticLines.length) return;
    indexes.set(bookId, toIndexed(staticLines));
    sources.set(bookId, 'static');
  })()
    .catch(() => { /* 加载失败视为无映射，调用方回退整段播放 */ })
    .finally(() => { loading.delete(bookId); });
  loading.set(bookId, task);
  return task;
}

/** 保存/删除对齐结果后立刻更新内存索引，不用等下次 loadAlignment。 */
export function registerAlignment(bookId: string, lines: AlignedLine[]): void {
  indexes.set(bookId, toIndexed(lines));
  sources.set(bookId, 'runtime');
}
export function clearAlignment(bookId: string): void {
  indexes.delete(bookId);
  sources.delete(bookId);
}

/**
 * 用词重叠率在映射里找最匹配的一句，返回其时间跨度。
 * 用户划选的文本可能和 OCR 行有出入（多词/少词/错字），词重叠率可容错。
 * 找不到（重叠率过低 / 该书无对齐数据）返回 null。
 */
export function findAudioSpan(bookId: string | undefined, text: string): AudioSpan | null {
  const lines = bookId ? indexes.get(bookId) : undefined;
  if (!lines?.length) return null;
  const target = norm(text);
  if (!target.length) return null;
  const targetSet = new Set(target);
  let best: AudioSpan | null = null;
  let bestScore = 0;
  for (const line of lines) {
    let inter = 0;
    for (const w of targetSet) if (line.set.has(w)) inter += 1;
    const score = inter / Math.max(targetSet.size, line.set.size);
    if (score > bestScore) { bestScore = score; best = { start: line.s, end: line.e }; }
  }
  return bestScore > 0.4 ? best : null;
}
