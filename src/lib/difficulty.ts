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

export interface BookRecommendation { book: Book; coverage: number; band: DifficultyBand; reason: string }
export interface ColdStartPick { book: Book; reason: string }

const LEVEL_ORDER: Record<string, number> = { A1: 0, A2: 1, B1: 2, B2: 3 };

/** 冷启动推荐：还没有任何已知词时，挑最低级别的分级书（优先未读），把新用户引进入门阶梯。 */
export function coldStartPick(books: Book[]): ColdStartPick | null {
  const graded = books.filter((b) => b.level && LEVEL_ORDER[b.level] !== undefined);
  if (!graded.length) return null;
  const pick = [...graded].sort((a, b) => (LEVEL_ORDER[a.level!] - LEVEL_ORDER[b.level!]) || (a.progress - b.progress))[0];
  return { book: pick, reason: '还没有已知词积累——先从最轻松的分级读起；读时把认识的词标「已掌握」，推荐会越来越准。' };
}

/** 今日推荐：在可评估的书里挑最接近 i+1 的一本（理想区间优先、其次贴近 94%、再优先未读完）。known 为空返回 null。 */
export function recommendBook(books: Book[], known: ReadonlySet<string>): BookRecommendation | null {
  if (!known.size) return null;
  let best: BookRecommendation | null = null;
  let bestScore = -Infinity;
  for (const book of books) {
    const diff = bookDifficulty(book, known);
    if (!diff) continue;
    const score = (diff.band.ideal ? 1000 : 0) - Math.abs(diff.coverage - 94) - book.progress * 0.1;
    if (score > bestScore) {
      bestScore = score;
      const reason = diff.band.ideal
        ? `覆盖率 ${diff.coverage}%：多数词认识、少量新词，正适合现在的你。`
        : diff.band.key === 'easy'
          ? `覆盖率 ${diff.coverage}%：读起来轻松，适合保持阅读节奏。`
          : diff.band.key === 'stretch'
            ? `覆盖率 ${diff.coverage}%：略有挑战，打开常驻注音就能读得动。`
            : `覆盖率 ${diff.coverage}%：新词较多，建议先读分级桥再回来。`;
      best = { book, coverage: diff.coverage, band: diff.band, reason };
    }
  }
  return best;
}
