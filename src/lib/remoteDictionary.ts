import type { DictionaryEntry } from '../types';

// ── 共享词典客户端（Pathmora 统一） ─────────────────────────────────────────────
// pathmora / linguaflow / linguaflow-reader 共用同一个后端词典服务 `/dict/*`
// （LinguaFlow server/src/dict.ts，ECDICT 等四语 SQLite，公开只读、按 IP 限流）。
// 本模块是该共享服务的参考客户端：canonical base 可配置、预留统一账号 Bearer 钩子，
// 三个产品可直接复用同一份实现，避免各自维护查词逻辑。
//
// 在线兜底分两层：① 共享服务器英汉词典（中文释义，覆盖生僻词 / 变形词 / 专名）；
// ② 免费 Free Dictionary API（英文释义 / 例句 / 同义词），服务器不可达时二次兜底。
// 完全可选：离线 / 超时 / 被墙都安静返回 null，调用方回退本地词库或「未收录」提示，不阻塞核心阅读。

export const DEFAULT_DICT_BASE = 'https://linguaflow.pathmora.cn/api';
const BASE_OVERRIDE_KEY = 'pathmora_dict_base';
// 统一账号预留：未来 Pathmora 统一登录后把 token 写入该 key，查词请求自动带 Bearer。
// /dict 目前公开只读、忽略鉴权；带上 token 是为将来「按账号个性化 / 计费 / 限流」留口。
const AUTH_TOKEN_KEY = 'pathmora_auth_token';

let dictBase = DEFAULT_DICT_BASE;
try {
  const override = localStorage.getItem(BASE_OVERRIDE_KEY);
  if (override) dictBase = override.replace(/\/+$/, '');
} catch { /* 非浏览器 / 隐私模式：用默认 base */ }

/** 覆盖共享词典 base（自托管 / 未来统一域名，如 https://api.pathmora.cn）。 */
export function setDictionaryBase(base: string): void {
  dictBase = base.replace(/\/+$/, '') || DEFAULT_DICT_BASE;
}
export function getDictionaryBase(): string { return dictBase; }

function authHeaders(): Record<string, string> {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch { return {}; }
}

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

async function getJson(url: string, signal: AbortSignal, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(url, { signal, headers });
  if (!response.ok) return null;
  return response.json();
}

/** 在线查词兜底：共享服务器英汉词典优先，Free Dictionary API 二次兜底。带内存缓存与超时；任何失败返回 null（不抛错）。 */
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
      const data = (await getJson(`${getDictionaryBase()}/dict/lookup?w=${encodeURIComponent(key)}&lang=en`, controller.signal, authHeaders())) as ServerRow | null;
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
