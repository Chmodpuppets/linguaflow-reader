import { getDictionaryBase } from './remoteDictionary';

// 学习记录上云（P1，opt-in）。reader 只负责「捕获 + 练习」并把发生的事上报；
// 复习调度 / 学习计划归 pathmora（消费 /learn/summary）。默认关闭，未开启不收集任何事件。
export type LearnEventType = 'lookup' | 'save_sentence' | 'shadow' | 'review';
export interface LearnEvent {
  type: LearnEventType;
  word?: string;
  sentenceId?: string;
  bookId?: string;
  payload?: Record<string, unknown>;
  at: number;
}

const QUEUE_KEY = 'lf_learn_queue';
const ENABLED_KEY = 'lf_learn_sync_enabled';
const TOKEN_KEY = 'lf_sync_token';
const MAX_QUEUE = 500;

const read = (key: string): string => {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
};
const write = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* 存储不可用时静默降级 */ }
};

export const isSyncEnabled = (): boolean => read(ENABLED_KEY) === '1';
export const setSyncEnabled = (on: boolean) => write(ENABLED_KEY, on ? '1' : '0');
export const getSyncToken = (): string => read(TOKEN_KEY);
export const setSyncToken = (token: string) => write(TOKEN_KEY, token);
export const clearSyncToken = () => write(TOKEN_KEY, '');

const readQueue = (): LearnEvent[] => {
  try { const parsed = JSON.parse(read(QUEUE_KEY) || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
};
const writeQueue = (events: LearnEvent[]) => write(QUEUE_KEY, JSON.stringify(events.slice(-MAX_QUEUE)));
export const pendingCount = (): number => readQueue().length;

/** 记录一条学习事件。仅在用户开启同步后入队；入队后尝试立即补传。 */
export function recordEvent(event: Omit<LearnEvent, 'at'>) {
  if (!isSyncEnabled()) return;
  const queue = readQueue();
  queue.push({ ...event, at: Date.now() });
  writeQueue(queue);
  void flushQueue();
}

/** 把离线队列补传到 linguaflow /learn/events。失败保留队列，联网后重试。 */
export async function flushQueue(): Promise<{ sent: number; pending: number }> {
  const token = getSyncToken();
  if (!isSyncEnabled() || !token || typeof navigator !== 'undefined' && !navigator.onLine) return { sent: 0, pending: pendingCount() };
  const queue = readQueue();
  if (!queue.length) return { sent: 0, pending: 0 };
  try {
    const res = await fetch(`${getDictionaryBase()}/learn/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ events: queue }),
    });
    if (!res.ok) return { sent: 0, pending: queue.length };
    writeQueue([]);
    return { sent: queue.length, pending: 0 };
  } catch {
    return { sent: 0, pending: queue.length };
  }
}

/** 连接账号，拿到 token 作为学习记录身份。
 *  统一身份以 pathmora 为准：provider='pathmora' 用 pathmora 账号（email）登录，
 *  其 token 由 linguaflow 身份桥接信任；provider='linguaflow' 为旧账号回退（username）。 */
export async function connectAccount(provider: 'pathmora' | 'linguaflow', identifier: string, password: string, mode: 'login' | 'register'): Promise<{ ok: boolean; error?: string }> {
  try {
    const base = provider === 'pathmora' ? getPlanBase() : getDictionaryBase();
    const payload = provider === 'pathmora'
      ? { email: identifier, password, name: identifier }
      : { username: identifier, password, language: 'en' };
    const res = await fetch(`${base}/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.token) return { ok: false, error: body?.error || `连接失败（${res.status}）` };
    setSyncToken(body.token);
    return { ok: true };
  } catch {
    return { ok: false, error: '网络不可用，请稍后再试' };
  }
}

// P2：复习计划由 pathmora 学习大脑下发（复习归 pathmora）。reader 只执行并回传结果。
// pathmora 与 reader 不同源，计划接口独立 base；默认指向真实 pathmora 中国站 API。
const PLAN_BASE_KEY = 'pathmora_plan_base';
const DEFAULT_PLAN_BASE = 'https://www.pathmora.cn/api';
export const getPlanBase = (): string => read(PLAN_BASE_KEY) || DEFAULT_PLAN_BASE;
export const setPlanBase = (base: string) => write(PLAN_BASE_KEY, base);

export interface ReaderPlanTask { word: string; misses: number; kind: 'weak' | 'reinforce' }
export interface ReaderPlan {
  ok: boolean;
  generatedAt: number;
  todayMinutes: number;
  readingRewardMinutes: number;
  due: ReaderPlanTask[];
  stats: { knownCount: number; weakCount: number; savedSentences: number };
  source?: 'pathmora' | 'fallback';
}

/** 拉取 pathmora 下发的今日复习计划。未开启 / 无 token / 不可达时返回 null（回退本地 SRS）。 */
export async function fetchReaderPlan(): Promise<ReaderPlan | null> {
  const token = getSyncToken();
  if (!isSyncEnabled() || !token) return null;
  try {
    const res = await fetch(`${getPlanBase()}/reader/plan`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const plan = (await res.json()) as ReaderPlan;
    return plan && Array.isArray(plan.due) ? { ...plan, source: 'pathmora' } : null;
  } catch {
    return null;
  }
}

/** pathmora 不可达时的本地降级计划：用已部署的 linguaflow /learn/summary（薄弱词优先+已知词强化）。
 *  明确标记 source:'fallback'，pathmora 连接后自动升级为大脑下发。复习调度权威仍归 pathmora。 */
export async function fetchFallbackPlan(): Promise<ReaderPlan | null> {
  const token = getSyncToken();
  if (!isSyncEnabled() || !token) return null;
  try {
    const res = await fetch(`${getDictionaryBase()}/learn/summary`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const weakRaw: unknown[] = Array.isArray(body?.weakWords) ? body.weakWords : [];
    const weak = weakRaw
      .map((w) => typeof w === 'string' ? { word: w, misses: 1 } : { word: (w as { word?: string })?.word, misses: Number((w as { misses?: number; count?: number })?.misses ?? (w as { count?: number })?.count ?? 1) })
      .filter((w): w is { word: string; misses: number } => typeof w.word === 'string' && !!w.word);
    weak.sort((a, b) => b.misses - a.misses);
    const knownRaw: unknown[] = Array.isArray(body?.knownWords) ? body.knownWords : [];
    const known = knownRaw.map((w) => typeof w === 'string' ? w : (w as { word?: string })?.word).filter((w): w is string => typeof w === 'string');
    const due: ReaderPlanTask[] = [
      ...weak.map((w) => ({ word: w.word, misses: w.misses, kind: 'weak' as const })),
      ...known.filter((w) => !weak.some((x) => x.word === w)).map((w) => ({ word: w, misses: 0, kind: 'reinforce' as const })),
    ].slice(0, 12);
    if (!due.length) return null;
    return {
      ok: true, generatedAt: Date.now(), todayMinutes: 10, readingRewardMinutes: 15, due,
      stats: { knownCount: known.length, weakCount: weak.length, savedSentences: Number(body?.savedSentences) || 0 },
      source: 'fallback',
    };
  } catch {
    return null;
  }
}

// P3：已知词来自 pathmora 积累（linguaflow /learn/summary 的 knownWords），供难度匹配。
// 缓存于本机（10 分钟 TTL），未连接 / 不可达时返回缓存或空，reader 回退本地已知词。
const KNOWN_KEY = 'lf_known_words';
const KNOWN_AT_KEY = 'lf_known_words_at';
const KNOWN_TTL = 10 * 60_000;

export const getCachedKnownWords = (): string[] => {
  try { const parsed = JSON.parse(read(KNOWN_KEY) || '[]'); return Array.isArray(parsed) ? parsed.filter((w): w is string => typeof w === 'string') : []; } catch { return []; }
};
export const knownWordsStale = (): boolean => Date.now() - Number(read(KNOWN_AT_KEY) || 0) > KNOWN_TTL;

/** 拉取并缓存已知词。未开启 / 无 token / 不可达返回 null（调用方用缓存或本地回退）。 */
export async function refreshKnownWords(): Promise<string[] | null> {
  const token = getSyncToken();
  if (!isSyncEnabled() || !token) return null;
  try {
    const res = await fetch(`${getDictionaryBase()}/learn/summary`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const raw = Array.isArray(body?.knownWords) ? body.knownWords : [];
    const words = raw.map((w: unknown) => typeof w === 'string' ? w : (w as { word?: string })?.word).filter((w: unknown): w is string => typeof w === 'string');
    write(KNOWN_KEY, JSON.stringify(words));
    write(KNOWN_AT_KEY, String(Date.now()));
    return words;
  } catch {
    return null;
  }
}

// 学习档案：把 /learn/summary 归一化成可直接展示的形状，让「上云」对用户可见、可感。
export interface LearnSummary {
  knownCount: number;
  weak: { word: string; misses: number }[];
  savedSentences: number;
  shadow: { count: number; avgAccuracy: number; avgWpm: number };
  activityDays: number;
  counts: { lookup: number; save_sentence: number; shadow: number; review: number };
}

/** 拉取学习档案。未开启 / 无 token / 不可达返回 null（调用方隐藏面板）。 */
export async function fetchLearnSummary(): Promise<LearnSummary | null> {
  const token = getSyncToken();
  if (!isSyncEnabled() || !token) return null;
  try {
    const res = await fetch(`${getDictionaryBase()}/learn/summary`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const weakRaw: unknown[] = Array.isArray(body?.weakWords) ? body.weakWords : [];
    const weak = weakRaw
      .map((w) => typeof w === 'string' ? { word: w, misses: 1 } : { word: (w as { word?: string })?.word, misses: Number((w as { misses?: number; count?: number })?.misses ?? (w as { count?: number })?.count ?? 1) })
      .filter((w): w is { word: string; misses: number } => typeof w.word === 'string' && !!w.word)
      .sort((a, b) => b.misses - a.misses);
    const knownRaw: unknown[] = Array.isArray(body?.knownWords) ? body.knownWords : [];
    const knownCount = knownRaw.length;
    const counts = body?.counts || {};
    return {
      knownCount,
      weak,
      savedSentences: Number(body?.savedSentences) || 0,
      shadow: { count: Number(body?.shadow?.count) || 0, avgAccuracy: Number(body?.shadow?.avgAccuracy) || 0, avgWpm: Number(body?.shadow?.avgWpm) || 0 },
      activityDays: Number(body?.activityDays) || 0,
      counts: { lookup: Number(counts.lookup) || 0, save_sentence: Number(counts.save_sentence) || 0, shadow: Number(counts.shadow) || 0, review: Number(counts.review) || 0 },
    };
  } catch {
    return null;
  }
}

/** 启动后台补传：联网恢复 + 周期性 flush。App 挂载时调用一次。 */
export function startLearningSync() {
  if (typeof window === 'undefined') return;
  window.addEventListener('online', () => void flushQueue());
  window.setInterval(() => void flushQueue(), 60_000);
}
