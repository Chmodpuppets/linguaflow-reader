import type { AppData } from '../types';

// 跨标签页「刚收藏的词不见了」的兜底：整份快照按 rev 采纳时，如果对方快照还没包含
// 本标签最近几秒刚加的记录（对方写盘发生在我们的广播送达之前）， wholesale 采纳会把它们抹掉。
// 这里在采纳前把「本地最近创建、且对方快照里没有」的收藏类记录并回去，确保刚收藏的词/句/标记不丢。
// 只保护最近窗口内的新增：较早的记录以对方快照为准，正常的删除仍能跨标签页传播。
const RECENT_WINDOW_MS = 10_000;

type Timed = { id: string; createdAt?: string };

function recentOnly<T extends Timed>(local: T[], incoming: T[], now: number): T[] {
  const ids = new Set(incoming.map((entry) => entry.id));
  return local.filter((entry) => !ids.has(entry.id) && !!entry.createdAt && now - Date.parse(entry.createdAt) < RECENT_WINDOW_MS);
}

export function mergeRecentAdds(local: AppData, incoming: AppData, now = Date.now()): { data: AppData; preserved: number } {
  const vocabulary = recentOnly(local.vocabulary, incoming.vocabulary, now);
  const highlights = recentOnly(local.highlights, incoming.highlights, now);
  const sentences = recentOnly(local.sentences || [], incoming.sentences || [], now);
  const reviewLogs = recentOnly(local.reviewLogs, incoming.reviewLogs, now);
  const voiceRecords = recentOnly(local.voiceRecords, incoming.voiceRecords, now);
  const libraryViews = recentOnly(local.libraryViews || [], incoming.libraryViews || [], now);
  const preserved = vocabulary.length + highlights.length + sentences.length + reviewLogs.length + voiceRecords.length + libraryViews.length;
  const data: AppData = {
    ...incoming,
    vocabulary: [...incoming.vocabulary, ...vocabulary],
    highlights: [...incoming.highlights, ...highlights],
    sentences: [...(incoming.sentences || []), ...sentences],
    reviewLogs: [...incoming.reviewLogs, ...reviewLogs],
    voiceRecords: [...incoming.voiceRecords, ...voiceRecords],
    libraryViews: [...(incoming.libraryViews || []), ...libraryViews],
  };
  return { data, preserved };
}
