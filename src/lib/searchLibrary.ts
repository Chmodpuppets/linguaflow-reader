import type { Book } from '../types';

/** 一条全文搜索命中：定位到书 / 章 / 段，并带匹配词前后的小段语境。 */
export interface SearchSnippet {
  before: string;
  match: string;
  after: string;
}

export interface SearchHit {
  bookId: string;
  bookTitle: string;
  chapterId: string;
  chapterTitle: string;
  chapterIndex: number;
  paragraphIndex: number;
  snippet: SearchSnippet;
}

/** 匹配词前后各保留的字符数（语境窗口）。 */
const BEFORE_RADIUS = 36;
const AFTER_RADIUS = 64;

/** 从段落里截取匹配词前后语境，超出窗口处补省略号。纯函数，便于单测。 */
export function buildSnippet(paragraph: string, index: number, matchLength: number): SearchSnippet {
  const start = Math.max(0, index - BEFORE_RADIUS);
  const end = Math.min(paragraph.length, index + matchLength + AFTER_RADIUS);
  return {
    before: (start > 0 ? '…' : '') + paragraph.slice(start, index),
    match: paragraph.slice(index, index + matchLength),
    after: paragraph.slice(index + matchLength, end) + (end < paragraph.length ? '…' : ''),
  };
}

/**
 * 跨书全文搜索：在所有书籍正文里按大小写不敏感子串查找词或短语。
 * 每段只取首个命中（结果干净）；每本书最多 maxPerBook 条（避免一本大书刷屏）；总数封顶 limit。
 * 纯前端、零外部依赖；正文已在内存/IndexedDB，个人书库规模下逐次扫描足够快。
 */
export function searchLibrary(
  books: Book[],
  rawQuery: string,
  opts: { limit?: number; maxPerBook?: number } = {},
): SearchHit[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];
  const limit = opts.limit ?? 80;
  const maxPerBook = opts.maxPerBook ?? 10;
  const hits: SearchHit[] = [];
  for (const book of books) {
    let perBook = 0;
    const chapters = book.chapters || [];
    for (let ci = 0; ci < chapters.length && perBook < maxPerBook; ci += 1) {
      const chapter = chapters[ci];
      const paragraphs = chapter.paragraphs || [];
      for (let pi = 0; pi < paragraphs.length && perBook < maxPerBook; pi += 1) {
        const paragraph = paragraphs[pi];
        const index = paragraph.toLowerCase().indexOf(query);
        if (index < 0) continue;
        hits.push({
          bookId: book.id,
          bookTitle: book.title,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          chapterIndex: ci,
          paragraphIndex: pi,
          snippet: buildSnippet(paragraph, index, query.length),
        });
        perBook += 1;
        if (hits.length >= limit) return hits;
      }
    }
  }
  return hits;
}
