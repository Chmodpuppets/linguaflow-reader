import type { DictionaryEntry } from '../types';

// 本地词库只覆盖少量高频学习词；小说里绝大多数词不在其中。在线兜底分两层：
// ① 项目自有的 LinguaFlow 服务器英汉词典（ECDICT，约 39.5 万词，公开只读、无需登录），
//    返回中文释义，覆盖生僻词 / 变形词 / 专名（如 gatsby）。接口见 linguaflow 仓 server/src/dict.ts。
// ② 免费 Free Dictionary API（英文释义 / 例句 / 同义词），服务器不可达时的二次兜底。
// 完全可选：离线 / 超时 / 被墙都安静返回 null，调用方回退本地词库或「未收录」提示，不阻塞核心阅读。
const SERVER_DICT = 'https://linguaflow.pathmora.cn/api/dict/lookup';
const FREE_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

export type RemoteSource = 'server' | 'free';
export interface RemoteResult { entry: DictionaryEntry; source: RemoteSource }

const cache = new Map<string, RemoteResult | null>();

interface ServerRow { found?: boolean; word?: string; phonetic?: string; meaning?: string; pos?: string }
interface ApiDefinition { definition?: string; example?: string; synonyms?: string[] }
interface ApiMeaning { partOfSpeech?: string; definitions?: ApiDefinition[]; synonyms?: string[] }
interface ApiEntry { word?: string; phonetic?: string; phonetics?: { text?: string }[]; meanings?: ApiMeaning[] }

function mapServer(row: ServerRow, word: string): DictionaryEntry | null {
  if (!row.found || !row.meaning) return null;
  // 服务器释义本身是中文（ECDICT 英汉），直接作为主释义展示。
  return {
    word: row.word || word,
    phonetic: row.phonetic || '',
    partOfSpeech: row.pos || '',
    meaning: row.meaning,
    chinese: '',
    usage: '',
    example: '',
    exampleCn: '',
    synonyms: [],
  };
}

function firstPhonetic(entry: ApiEntry): string {
  if (entry.phonetic) return entry.phonetic;
  return entry.phonetics?.find((p) => p.text)?.text || '';
}

function mapEntry(entry: ApiEntry, word: string): DictionaryEntry | null {
  const meanings = (entry.meanings || []).filter((m) => m.definitions?.length);
  if (!meanings.length) return null;
  const primary = meanings[0];
  const defs = primary.definitions || [];
  const withExample = defs.find((d) => d.example);
  const synonyms = Array.from(new Set([...(primary.synonyms || []), ...defs.flatMap((d) => d.synonyms || [])])).slice(0, 6);
  return {
    word,
    phonetic: firstPhonetic(entry),
    partOfSpeech: primary.partOfSpeech || '',
    meaning: defs.map((d) => d.definition).filter(Boolean).slice(0, 2).join(' '),
    chinese: '',
    usage: meanings.slice(1, 3).map((m) => `${m.partOfSpeech || ''}: ${(m.definitions || [])[0]?.definition || ''}`.trim()).filter((s) => s.length > 2).join(' '),
    example: withExample?.example || '',
    exampleCn: '',
    synonyms,
  };
}

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) return null;
  return response.json();
}

/** 在线查词兜底：服务器英汉词典优先，Free Dictionary API 二次兜底。带内存缓存与超时；任何失败返回 null（不抛错）。 */
export async function fetchRemoteDictionary(word: string): Promise<RemoteResult | null> {
  const key = word.toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;
  if (typeof fetch === 'undefined' || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    cache.set(key, null);
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    try {
      const data = (await getJson(`${SERVER_DICT}?w=${encodeURIComponent(key)}&lang=en`, controller.signal)) as ServerRow | null;
      const entry = data ? mapServer(data, key) : null;
      if (entry) { const result: RemoteResult = { entry, source: 'server' }; cache.set(key, result); return result; }
    } catch { /* 服务器不可达 → 二次兜底 */ }
    try {
      const data = (await getJson(`${FREE_API}${encodeURIComponent(key)}`, controller.signal)) as ApiEntry[] | null;
      const entry = Array.isArray(data) ? mapEntry(data[0], key) : null;
      if (entry) { const result: RemoteResult = { entry, source: 'free' }; cache.set(key, result); return result; }
    } catch { /* 忽略，回退本地 / 未收录 */ }
    cache.set(key, null);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
