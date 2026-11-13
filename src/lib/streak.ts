import type { AppData } from '../types';

/** 本地时区的 YYYY-MM-DD。 */
export function dayKey(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 收集所有「学习动作」时间戳（阅读/复习/跟读/收藏/标记/查词收藏）。 */
function activityTimestamps(data: AppData): string[] {
  const stamps: string[] = [];
  for (const book of data.books) if (book.lastReadAt) stamps.push(book.lastReadAt);
  for (const log of data.reviewLogs) stamps.push(log.createdAt);
  for (const record of data.voiceRecords) stamps.push(record.createdAt);
  for (const sentence of data.sentences || []) stamps.push(sentence.createdAt);
  for (const mark of data.highlights) stamps.push(mark.createdAt);
  return stamps.filter(Boolean);
}

/** 连续学习天数（含今天或昨天结尾），LingQ 式 streak。 */
export function computeStreak(data: AppData, now: Date = new Date()): number {
  const days = new Set(activityTimestamps(data).map((s) => dayKey(s)).filter(Boolean));
  if (!days.size) return 0;
  const cursor = new Date(now);
  // 今天还没学不打断昨天的 streak：从昨天起算也可以。
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
  return streak;
}

/** 今天的学习动作数（复习/跟读/收藏/标记），用于每日目标进度。 */
export function todayActions(data: AppData, now: Date = new Date()): number {
  const today = dayKey(now);
  return activityTimestamps(data).filter((s) => dayKey(s) === today).length;
}

/** 词状态汇总：已掌握 / 学习中（LingQ 的 known-word 计数）。 */
export function wordStateCounts(data: AppData): { known: number; learning: number } {
  let known = 0;
  let learning = 0;
  for (const state of Object.values(data.wordStates || {})) {
    if (state === 'known') known++;
    else if (state === 'learning') learning++;
  }
  return { known, learning };
}
