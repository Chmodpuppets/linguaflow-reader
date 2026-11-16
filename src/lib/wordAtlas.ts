import type { DictionaryEntry, WordGloss } from '../types';

// ── Word Atlas（词光）词库增强层 ─────────────────────────────────────────────
// 数据：CC BY 4.0，署名 "Word Atlas contributors"。文本（index.json + entries/*.json）由
// scripts/fetch-word-atlas.mjs 镜像到本机 public/atlas/（同源、离线可用）；插画/录音按需从
// 源站 CDN 懒加载（渐进增强，失败安静降级）。本层完全可选：任何缺失/失败都返回 null，
// 调用方回退本地词库或在线词典，不阻塞核心阅读。

export interface AtlasSense { pos: string; zh: string; en: string }
export interface AtlasExample { en: string; zh: string }
export interface AtlasWord {
  id: string;
  word: string;
  uk: string;
  us: string;
  senses: AtlasSense[];
  ex: AtlasExample[];
  col: string[];
  fam: string[];
  syn: string[];
  ant: string[];
  tip: string;
  note?: string;
  cefr: string;
  topic: string;
  topicZh: string;
  media: number;
  /** 命中的词头是否与查询词不同（变形词还原，如 wandered→wander）。 */
  lemmaOf?: string;
  entry: DictionaryEntry;
}

interface AtlasIndex {
  chunk: number;
  count: number;
  cefr: string[];
  topics: [string, string][];
  words: [string, string, string, string, number, number, number][];
}
interface RawAtlasEntry {
  w: string; uk?: string; us?: string;
  senses?: AtlasSense[]; ex?: AtlasExample[];
  col?: string[]; fam?: string[]; syn?: string[]; ant?: string[];
  tip?: string; note?: string; cefr?: string; topic?: string;
}

// 媒体位标记（与源站 index.json 一致）：1 插画 / 2 英音 / 4 美音 / 8 例句朗读 / 16 第二例句朗读。
export const MEDIA_IMG = 1, MEDIA_UK = 2, MEDIA_US = 4, MEDIA_EX = 8, MEDIA_EX1 = 16;

// 媒体（插画/录音）默认从自有阿里云 OSS 加载（bucket pathmora / oss-cn-beijing，对象 public-read），
// 取代源站 jsdelivr CDN——国内更稳、完全自托管。文本数据仍优先同源本地镜像（离线可用），OSS 作兜底。
const OSS_ATLAS_BASE = 'https://pathmora.oss-cn-beijing.aliyuncs.com/atlas/v1';
const DEFAULT_MEDIA_BASE = OSS_ATLAS_BASE;
const MEDIA_OVERRIDE_KEY = 'pathmora_atlas_media_base';
let mediaBase = DEFAULT_MEDIA_BASE;
try {
  const override = localStorage.getItem(MEDIA_OVERRIDE_KEY);
  if (override) mediaBase = override.replace(/\/+$/, '');
} catch { /* 非浏览器 / 隐私模式：用默认 OSS */ }

export function setAtlasMediaBase(base: string): void { mediaBase = base.replace(/\/+$/, '') || DEFAULT_MEDIA_BASE; }
export function getAtlasMediaBase(): string { return mediaBase; }

// 文本数据 base（同源本地镜像优先）。子路径部署时可覆盖；OSS 作为兜底来源。
let textBase = '/';
export function setAtlasTextBase(base: string): void { textBase = base.endsWith('/') ? base : `${base}/`; }
const TEXT_FALLBACK_BASE = OSS_ATLAS_BASE;

/** 归一化查询键：小写、折叠空白。 */
export function normalizeAtlasKey(word: string): string {
  return word.toLowerCase().trim().replace(/\s+/g, ' ');
}

/** 保守的词形还原候选（仅规则变化，且候选必须存在于词库才采用，避免张冠李戴）。 */
export function lemmaCandidates(word: string): string[] {
  const w = normalizeAtlasKey(word);
  const out: string[] = [];
  const push = (s: string) => { if (s && s.length >= 2 && !out.includes(s)) out.push(s); };
  // 双写辅音还原：stopp→stop、runn→run（仅当末尾两字母相同且为辅音）。
  const undouble = (s: string) => { if (s.length >= 3 && s[s.length - 1] === s[s.length - 2] && !'aeiou'.includes(s[s.length - 1])) push(s.slice(0, -1)); };
  // 复数 / 三单
  if (w.endsWith('ies')) push(w.slice(0, -3) + 'y');
  if (w.endsWith('es')) { push(w.slice(0, -2)); push(w.slice(0, -1)); }
  if (w.endsWith('s') && !w.endsWith('ss')) push(w.slice(0, -1));
  // 过去式 / 过去分词
  if (w.endsWith('ied')) push(w.slice(0, -3) + 'y');
  if (w.endsWith('ed')) { const stem = w.slice(0, -2); push(stem); push(stem + 'e'); undouble(stem); }
  // 现在分词
  if (w.endsWith('ing')) { const stem = w.slice(0, -3); push(stem); push(stem + 'e'); undouble(stem); }
  return out;
}

/** 把源站词条映射为本应用 DictionaryEntry（可直接灌进现有查词面板）。 */
export function mapAtlasEntry(raw: RawAtlasEntry, id: string, cefr: string, topic: string, topicZh: string, media: number, lemmaOf?: string): AtlasWord {
  const senses = raw.senses || [];
  const ex = raw.ex || [];
  const entry: DictionaryEntry = {
    word: raw.w,
    phonetic: raw.uk || raw.us || '',
    partOfSpeech: senses[0]?.pos || '',
    meaning: senses.map((s) => s.en).filter(Boolean).slice(0, 2).join(' ') || senses[0]?.zh || '',
    chinese: senses.map((s) => s.zh).filter(Boolean).join('；'),
    usage: raw.tip || '',
    example: ex[0]?.en || '',
    exampleCn: ex[0]?.zh || '',
    synonyms: (raw.syn || []).slice(0, 6),
  };
  return {
    id, word: raw.w, uk: raw.uk || '', us: raw.us || '',
    senses, ex, col: raw.col || [], fam: raw.fam || [], syn: raw.syn || [], ant: raw.ant || [],
    tip: raw.tip || '', note: raw.note, cefr, topic, topicZh, media, lemmaOf, entry,
  };
}

export interface AtlasMedia { img?: string; thumb?: string; uk?: string; us?: string; ex?: string; ex2?: string }
/** 按媒体位标记生成按需懒加载的媒体 URL（仅包含该词实际拥有的媒体）。 */
export function atlasMediaUrls(id: string, media: number): AtlasMedia {
  const b = mediaBase;
  const m: AtlasMedia = {};
  if (media & MEDIA_IMG) { m.img = `${b}/img/${id}.webp`; m.thumb = `${b}/thumb/${id}.webp`; }
  if (media & MEDIA_UK) m.uk = `${b}/audio/uk/${id}.mp3`;
  if (media & MEDIA_US) m.us = `${b}/audio/us/${id}.mp3`;
  if (media & MEDIA_EX) m.ex = `${b}/audio/ex/${id}.mp3`;
  if (media & MEDIA_EX1) m.ex2 = `${b}/audio/ex2/${id}.mp3`;
  return m;
}

// ── 懒加载 + 缓存 ────────────────────────────────────────────────────────────
let indexData: AtlasIndex | null = null;
let indexPromise: Promise<AtlasIndex | null> | null = null;
let wordMap = new Map<string, number>(); // key → rowIndex
const blockCache = new Map<number, Promise<RawAtlasEntry[] | null>>();
const entryCache = new Map<string, AtlasWord | null>();

async function fetchJson(url: string): Promise<unknown> {
  if (typeof fetch === 'undefined') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; } finally { clearTimeout(timer); }
}

/** 文本数据：同源本地镜像优先（离线可用、无 CORS），失败回退自有 OSS。path 如 'index.json' / 'entries/0.json'。 */
async function fetchAtlasText(path: string): Promise<unknown> {
  const local = await fetchJson(`${textBase}atlas/${path}`);
  if (local) return local;
  if (`${textBase}atlas/` !== `${TEXT_FALLBACK_BASE}/`) return fetchJson(`${TEXT_FALLBACK_BASE}/${path}`);
  return null;
}

/** 加载紧凑索引（一次，会话级缓存）。失败返回 null（词库增强不可用，回退在线词典）。 */
export function loadAtlasIndex(): Promise<AtlasIndex | null> {
  if (indexData) return Promise.resolve(indexData);
  if (!indexPromise) {
    indexPromise = fetchAtlasText('index.json').then((data) => {
      const idx = data as AtlasIndex | null;
      if (!idx || !Array.isArray(idx.words)) { indexPromise = null; return null; }
      indexData = idx;
      wordMap = new Map();
      idx.words.forEach((row, i) => {
        wordMap.set(normalizeAtlasKey(row[1]), i);
        if (row[0] !== row[1]) wordMap.set(normalizeAtlasKey(row[0]), i);
      });
      return idx;
    });
  }
  return indexPromise;
}

/** 索引是否已就绪（供同步 ruby 注音回退使用）。 */
export function atlasIndexReady(): boolean { return !!indexData; }

/** 同步取常驻注音释义（索引就绪后）：word→{zh,phonetic}，未收录返回 null。 */
export function atlasGloss(word: string): WordGloss | null {
  if (!indexData) return null;
  const key = normalizeAtlasKey(word);
  let ri = wordMap.get(key);
  if (ri === undefined) {
    for (const cand of lemmaCandidates(word)) { const r = wordMap.get(cand); if (r !== undefined) { ri = r; break; } }
  }
  if (ri === undefined) return null;
  const row = indexData.words[ri];
  const zh = (row[2] || '').replace(/^[a-z]+\.\s*/, ''); // 去掉 "n. " 词性前缀，ruby 更干净
  return zh ? { zh, phonetic: row[3] || undefined } : null;
}

function loadBlock(n: number): Promise<RawAtlasEntry[] | null> {
  if (!blockCache.has(n)) {
    blockCache.set(n, fetchAtlasText(`entries/${n}.json`).then((d) => (Array.isArray(d) ? d as RawAtlasEntry[] : null)));
  }
  return blockCache.get(n)!;
}

/** 查一个词：精确词头优先，其次保守词形还原。命中返回完整词条（含插画/音频/CEFR/搭配等），否则 null。 */
export async function lookupAtlas(word: string): Promise<AtlasWord | null> {
  const key = normalizeAtlasKey(word);
  if (entryCache.has(key)) return entryCache.get(key) ?? null;
  const idx = await loadAtlasIndex();
  if (!idx) return null;
  let ri = wordMap.get(key);
  let lemmaOf: string | undefined;
  if (ri === undefined) {
    for (const cand of lemmaCandidates(word)) {
      const r = wordMap.get(cand);
      if (r !== undefined) { ri = r; lemmaOf = idx.words[r][1]; break; }
    }
  }
  if (ri === undefined) { entryCache.set(key, null); return null; }
  const row = idx.words[ri];
  const chunk = idx.chunk || 100;
  const block = await loadBlock(Math.floor(ri / chunk));
  if (!block) return null;
  const raw = block[ri % chunk];
  if (!raw || normalizeAtlasKey(raw.w) !== normalizeAtlasKey(row[1])) { entryCache.set(key, null); return null; }
  const cefr = idx.cefr?.[row[4]] || '';
  const topicPair = idx.topics?.[row[5]];
  const result = mapAtlasEntry(raw, row[0], cefr, topicPair?.[0] || '', topicPair?.[1] || '', row[6], lemmaOf);
  entryCache.set(key, result);
  return result;
}

/** 测试钩子：重置会话缓存（仅单测用）。 */
export function __resetAtlas(): void {
  indexData = null; indexPromise = null; wordMap = new Map(); blockCache.clear(); entryCache.clear();
}
