import type { Book } from '../types';
import { sampleBooks } from './sampleBooks';

/**
 * 内置书全集 = 轻量样书 + **本机可选**的扫描书。
 *
 * 扫描书（226 页 OCR 全文）属于第三方版权作品的衍生文本，不随开源仓库分发：
 * 本机把 `npm run export:local-content` 生成的 JSON 放在 public/local-content/ 即可启用，
 * 新 clone 没有该文件时安静降级为只有轻量样书，不白屏、不报错。
 * 好处是书籍全文完全不进 JS bundle，公开构建产物里一个字都没有。
 */
const OPTIONAL_BOOK_URL = '/local-content/wimpy-kid.json';

async function loadOptionalBook(): Promise<Book | null> {
  try {
    const response = await fetch(OPTIONAL_BOOK_URL, { cache: 'no-cache' });
    if (!response.ok) return null;
    const book = await response.json() as Book;
    if (book?.id !== 'wimpy-kid-1' || !Array.isArray(book.chapters) || !book.chapters.length) return null;
    return book;
  } catch {
    return null;
  }
}

/** 本机素材缺失 / 离线首启时直接返回样书，不再额外导出一个零引用的兜底函数。 */
export async function loadBuiltinBooks(): Promise<Book[]> {
  const optional = await loadOptionalBook();
  return optional ? [...sampleBooks, optional] : sampleBooks;
}
