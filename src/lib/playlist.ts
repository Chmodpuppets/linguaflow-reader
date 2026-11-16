import type { Book, Playlist } from '../types';

/**
 * 播放列表纯逻辑（无浏览器依赖，便于 node 单测）。
 * 队列只存 bookId；播放时再解析音频，无音频的书由播放器自动跳过。
 */

/** 按队列顺序把 bookId 解析成书，跳过已删除/不存在的 id，并去重（保持首次出现顺序）。 */
export function resolvePlaylistBooks(playlist: Playlist, books: Book[]): Book[] {
  const byId = new Map(books.map((b) => [b.id, b]));
  const seen = new Set<string>();
  const out: Book[] = [];
  for (const id of playlist.bookIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const book = byId.get(id);
    if (book) out.push(book);
  }
  return out;
}

/** 加入队列：已存在则不重复添加，否则追加到末尾。返回新数组。 */
export function addBookToPlaylist(bookIds: string[], bookId: string): string[] {
  if (!bookId || bookIds.includes(bookId)) return [...bookIds];
  return [...bookIds, bookId];
}

/** 从队列移除某本书（不存在则原样返回副本）。 */
export function removeBookFromPlaylist(bookIds: string[], bookId: string): string[] {
  return bookIds.filter((id) => id !== bookId);
}

/** 把 from 位置的曲目移动到 to 位置（越界自动夹取，原地移动返回副本）。 */
export function moveBook(bookIds: string[], from: number, to: number): string[] {
  const next = [...bookIds];
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(next.length - 1, to));
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

/** 自动连播的下一首索引：到末尾返回 null（停止，不循环）。 */
export function nextIndex(current: number, total: number): number | null {
  const next = current + 1;
  return next < total ? next : null;
}

/** 上一首索引：已在第一首返回 null。 */
export function prevIndex(current: number): number | null {
  return current > 0 ? current - 1 : null;
}
