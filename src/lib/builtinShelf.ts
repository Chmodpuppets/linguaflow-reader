import { sampleBooks } from '../data/sampleBooks';
import { gradedBooks } from '../data/gradedReaders';

// 用户要求「删掉样书、自己导入 EPUB」。默认书架不再预置样书/分级/经典，
// 但测试与 node 单测仍需要内置书作为夹具，故用运行时开关：
// 浏览器默认关闭（空书架），测试通过 addInitScript 置 __LF_BUILTIN_SHELF__='1' 打开。
const CLASSIC_IDS = [
  'alices-adventures-in-wonderland',
  'tom-sawyer',
  'the-secret-garden',
  'the-wonderful-wizard-of-oz',
  'a-christmas-carol',
  'the-little-prince-retelling',
];

export const BUILTIN_BOOK_IDS: ReadonlySet<string> = new Set([
  ...sampleBooks.map((b) => b.id),
  ...gradedBooks.map((b) => b.id),
  ...CLASSIC_IDS,
]);

export function builtinShelfEnabled(): boolean {
  if (typeof window === 'undefined') return true; // node / 单测
  return (window as unknown as { __LF_BUILTIN_SHELF__?: string }).__LF_BUILTIN_SHELF__ === '1';
}
