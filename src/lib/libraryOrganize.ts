import type { Book, LibraryView } from '../types';

// 书库组织：标签 + 保存的视图。纯逻辑，便于单测。

/** 汇总全部书的标签，去重、按字母排序。 */
export function allTags(books: Pick<Book, 'tags'>[]): string[] {
  const set = new Set<string>();
  for (const book of books) for (const tag of book.tags || []) if (tag.trim()) set.add(tag.trim());
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/** 按标签筛选；tag 为空返回全部。 */
export function filterByTag<T extends Pick<Book, 'tags'>>(books: T[], tag: string): T[] {
  if (!tag) return books;
  return books.filter((book) => (book.tags || []).some((t) => t.trim() === tag));
}

/** 解析用户输入的标签：按逗号 / 顿号 / 分号 / 换行切分，去空白、去重、限长、保序。 */
export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[,，、;；\n]+/)) {
    const tag = raw.trim().replace(/\s+/g, ' ').slice(0, 24);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out.slice(0, 12);
}

/** 当前筛选组合是否与某视图一致（用于高亮「当前视图」）。 */
export function viewMatches(view: LibraryView, current: { query: string; sortMode: 'default' | 'match'; onlyIdeal: boolean; tag: string }): boolean {
  return view.query === current.query && view.sortMode === current.sortMode && view.onlyIdeal === current.onlyIdeal && view.tag === current.tag;
}
