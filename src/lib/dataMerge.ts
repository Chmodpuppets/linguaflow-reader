import type { AppData } from '../types';

// 跨标签页合并：整份快照按 rev 采纳时，若对方快照缺少本标签收藏的记录，wholesale 覆盖会把它们抹掉
// （这是「收藏了单词但词汇本里没有」的根因）。早期版本只保护最近 10 秒的新增，后台标签页隔几分钟
// 再写盘仍会丢词。这里改为**按 id 取并集**：本标签有、对方没有的收藏记录一律保留，与创建时间无关，
// 从根本上杜绝「刚收藏的词被另一个标签页的旧快照覆盖」。
//
// 并集会让「删除」无法跨标签页传播（对方仍持有该记录，并集又把它加回来）。为此引入墓碑：
//   · 删除记录时把 id → 删除时刻 记进 AppData.tombstones；
//   · 合并时取双方墓碑的并集（同 id 取较新时刻），凡被墓碑标记、且记录创建时间不晚于删除时刻的一律剔除；
//   · 撤销删除会重新加入记录并刷新 createdAt（晚于墓碑），于是自动「复活」，无需手工清墓碑。
// 这样新增永不丢、删除能传播、撤销能复活，三者兼得。

type Timed = { id: string; createdAt?: string };

const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 墓碑保留 30 天，足够覆盖长期后台标签页，又不会无限膨胀

function mergeTombstones(local: Record<string, number> | undefined, incoming: Record<string, number> | undefined, now: number): Record<string, number> {
  const merged: Record<string, number> = { ...(incoming || {}) };
  for (const [id, at] of Object.entries(local || {})) merged[id] = Math.max(merged[id] || 0, at);
  // 剪掉过期墓碑：超过 TTL 的删除早已在所有标签页生效，无需再保留。
  for (const [id, at] of Object.entries(merged)) if (now - at > TOMBSTONE_TTL_MS) delete merged[id];
  return merged;
}

function mergeCollection<T extends Timed>(local: T[], incoming: T[], tombstones: Record<string, number>): { items: T[]; preserved: number } {
  const byId = new Map<string, T>();
  for (const item of incoming) byId.set(item.id, item); // 共享 id 以对方（较新 rev）版本为准
  let preserved = 0;
  for (const item of local) {
    if (!byId.has(item.id)) { byId.set(item.id, item); preserved += 1; } // 本标签独有：保留
  }
  const items: T[] = [];
  for (const item of byId.values()) {
    const deletedAt = tombstones[item.id];
    if (deletedAt !== undefined) {
      const created = item.createdAt ? Date.parse(item.createdAt) : 0;
      if (created <= deletedAt) continue; // 被删除且非撤销复活：剔除
    }
    items.push(item);
  }
  return { items, preserved };
}

export function mergeSnapshots(local: AppData, incoming: AppData, now = Date.now()): { data: AppData; preserved: number } {
  const tombstones = mergeTombstones(local.tombstones, incoming.tombstones, now);
  const vocabulary = mergeCollection(local.vocabulary, incoming.vocabulary, tombstones);
  const highlights = mergeCollection(local.highlights, incoming.highlights, tombstones);
  const sentences = mergeCollection(local.sentences || [], incoming.sentences || [], tombstones);
  const reviewLogs = mergeCollection(local.reviewLogs, incoming.reviewLogs, tombstones);
  const voiceRecords = mergeCollection(local.voiceRecords, incoming.voiceRecords, tombstones);
  const libraryViews = mergeCollection(local.libraryViews || [], incoming.libraryViews || [], tombstones);
  const playlists = mergeCollection(local.playlists || [], incoming.playlists || [], tombstones);
  const books = mergeCollection(local.books, incoming.books, tombstones);
  const preserved = vocabulary.preserved + highlights.preserved + sentences.preserved + reviewLogs.preserved + voiceRecords.preserved + libraryViews.preserved + playlists.preserved + books.preserved;
  const data: AppData = {
    ...incoming,
    tombstones,
    vocabulary: vocabulary.items,
    highlights: highlights.items,
    sentences: sentences.items,
    reviewLogs: reviewLogs.items,
    voiceRecords: voiceRecords.items,
    libraryViews: libraryViews.items,
    playlists: playlists.items,
    books: books.items,
  };
  return { data, preserved };
}
