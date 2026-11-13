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

/** 登录 / 注册 linguaflow 账号，拿到 token 作为学习记录身份。 */
export async function connectAccount(username: string, password: string, mode: 'login' | 'register'): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${getDictionaryBase()}/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, language: 'en' }),
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
    return plan && Array.isArray(plan.due) ? plan : null;
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
