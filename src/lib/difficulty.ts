import type { Book, Chapter } from '../types';
import { wordTokens } from './voice';

// P3 · 难度匹配：覆盖率 = 书里你已认识的词占全书词次的比例（词频加权）。
// 90–98% 判为 i+1（略高于现有水平、最利于习得）；已知词来自 pathmora 积累（/learn/summary），
// 未连接时回退本地复习 / 词汇记录。纯函数，便于单测与离线计算。

/** 常见功能词不计入覆盖率：它们几乎总是「认识」，会虚高难度评估。 */
export const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'so', 'as', 'of', 'at', 'by', 'for',
  'with', 'about', 'against', 'between', 'into', 'through', 'during', 'before', 'after', 'above',
  'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'too', 'very', 'can',
  'will', 'just', 'should', 'now', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'you', 'your',
  'yours', 'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its', 'they', 'them', 'their', 'theirs',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'would',
  'could', 'ought', 'until', 'while', 'because', 'although', 'though', 'unless', 'since', 'upon',
  'onto', 'within', 'without', 'also', 'ever', 'every', 'much', 'many', 'may', 'might', 'must',
  'shall', 'us', 'one', 'two', 'said', 'says', 'say', 'get', 'got', 'go', 'goes', 'went', 'gone',
  'come', 'came', 'make', 'made', 'like', 'back', 'even', 'still', 'well', 'way', 'take', 'took',
]);

export type DifficultyKey = 'easy' | 'ideal' | 'stretch' | 'hard';
export interface DifficultyBand { key: DifficultyKey; label: string; ideal: boolean }

/** 统计全书内容词词频（小写、去功能词 / 纯数字 / 单字符）。 */
export function bookWordFreq(chapters: Pick<Chapter, 'paragraphs'>[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const chapter of chapters) {
    for (const paragraph of chapter.paragraphs) {
      for (const token of wordTokens(paragraph)) {
        if (token.length < 2 || STOPWORDS.has(token) || /^\d+$/.test(token)) continue;
        freq.set(token, (freq.get(token) || 0) + 1);
      }
    }
  }
  return freq;
}

/** 词频加权覆盖率（0–100，四舍五入）。全书无内容词时返回 0。 */
export function coveragePercent(freq: Map<string, number>, known: ReadonlySet<string>): number {
  let total = 0;
  let knownCount = 0;
  for (const [word, count] of freq) {
    total += count;
    if (known.has(word)) knownCount += count;
  }
  if (!total) return 0;
  return Math.round((knownCount / total) * 100);
}

/** 覆盖率 → 难度分档。90–98% 为 i+1 理想区间。 */
export function difficultyBand(coverage: number): DifficultyBand {
  if (coverage >= 98) return { key: 'easy', label: '轻松', ideal: false };
  if (coverage >= 90) return { key: 'ideal', label: '适中 · i+1', ideal: true };
  if (coverage >= 75) return { key: 'stretch', label: '进阶', ideal: false };
  return { key: 'hard', label: '挑战', ideal: false };
}

export interface BookDifficulty { coverage: number; band: DifficultyBand }

const freqCache = new Map<string, Map<string, number>>();

/** 计算一本书的难度（带词频缓存，签名变化才重算）。known 为空时返回 null（无法评估）。 */
export function bookDifficulty(book: Pick<Book, 'id' | 'chapters'>, known: ReadonlySet<string>): BookDifficulty | null {
  if (!known.size) return null;
  const paragraphs = book.chapters.reduce((n, c) => n + c.paragraphs.length, 0);
  const sig = `${book.id}:${book.chapters.length}:${paragraphs}`;
  let freq = freqCache.get(sig);
  if (!freq) {
    freq = bookWordFreq(book.chapters);
    if (freqCache.size > 64) freqCache.clear();
    freqCache.set(sig, freq);
  }
  const coverage = coveragePercent(freq, known);
  return { coverage, band: difficultyBand(coverage) };
}
