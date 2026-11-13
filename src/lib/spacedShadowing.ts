// Voice Lab v2 · Tier 3 ⑤：间隔重录（spaced shadowing）。
// 分散练习 + 检索：同一句话按 1/3/7 天间隔回到练习队列，隔天重录比当场重复更牢。
// 纯前端：voiceRecords 按 targetText 分组 + 到期计算，不新增模型/后端。

import type { VoiceRecord } from '../types';

export const SPACED_INTERVAL_DAYS = [1, 3, 7];

export interface ShadowAttempt {
  at: string;
  wpm: number;
  accuracy: number;
}

export interface ShadowGroup {
  key: string;
  targetText: string;
  attempts: ShadowAttempt[];
  count: number;
  lastAt: string;
  firstWpm: number;
  latestWpm: number;
  deltaWpm: number;
  firstAccuracy: number;
  latestAccuracy: number;
  deltaAccuracy: number;
}

export interface DueShadowing {
  group: ShadowGroup;
  intervalDays: number;
  daysSinceLast: number;
}

const norm = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');

export function nextIntervalDays(count: number): number {
  return SPACED_INTERVAL_DAYS[Math.min(Math.max(count - 1, 0), SPACED_INTERVAL_DAYS.length - 1)];
}

export function groupShadowings(records: VoiceRecord[]): ShadowGroup[] {
  const map = new Map<string, VoiceRecord[]>();
  for (const r of records) {
    if (r.mode !== 'shadowing' || !r.targetText.trim()) continue;
    const key = norm(r.targetText);
    const list = map.get(key) || [];
    list.push(r);
    map.set(key, list);
  }
  const groups: ShadowGroup[] = [];
  for (const [key, list] of map) {
    const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const attempts = sorted.map((r) => ({ at: r.createdAt, wpm: r.metrics.wpm, accuracy: r.metrics.accuracy }));
    const first = attempts[0];
    const latest = attempts[attempts.length - 1];
    groups.push({
      key,
      targetText: sorted[sorted.length - 1].targetText,
      attempts,
      count: attempts.length,
      lastAt: latest.at,
      firstWpm: first.wpm,
      latestWpm: latest.wpm,
      deltaWpm: latest.wpm - first.wpm,
      firstAccuracy: first.accuracy,
      latestAccuracy: latest.accuracy,
      deltaAccuracy: latest.accuracy - first.accuracy,
    });
  }
  return groups.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export function dueShadowings(groups: ShadowGroup[], now: number): DueShadowing[] {
  const due: DueShadowing[] = [];
  for (const group of groups) {
    const intervalDays = nextIntervalDays(group.count);
    const lastMs = new Date(group.lastAt).getTime();
    if (Number.isNaN(lastMs)) continue;
    const daysSinceLast = (now - lastMs) / 86400000;
    if (daysSinceLast >= intervalDays) due.push({ group, intervalDays, daysSinceLast });
  }
  return due.sort((a, b) => b.daysSinceLast - a.daysSinceLast);
}
