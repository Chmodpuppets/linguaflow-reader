import type { ReviewLog, VocabEntry, WordState } from '../types';

/**
 * 汇总「已知词」供难度匹配/今日推荐/覆盖率使用。
 * 三个本地来源 + 一个云端来源，全部小写去重：
 *  1. 复习判定 good/easy 的词，或熟悉度 ≥3 的词汇表词；
 *  2. 阅读时标为「已掌握」的词（wordStates）——让常驻注音的进步直接驱动选书难度；
 *  3. 云端 /learn/summary 的已知词（opt-in 同步）。
 * 纯函数，便于单测；离线时仅靠 1+2 也能工作（local-first）。
 */
export function computeKnownWords(
  vocabulary: VocabEntry[],
  reviewLogs: ReviewLog[],
  wordStates: Record<string, WordState>,
  syncKnown: string[],
): string[] {
  const goodIds = new Set(reviewLogs.filter((log) => log.result === 'good' || log.result === 'easy').map((log) => log.vocabId));
  const fromVocab = vocabulary.filter((entry) => goodIds.has(entry.id) || entry.familiarity >= 3).map((entry) => entry.word);
  const fromStates = Object.entries(wordStates || {}).filter(([, state]) => state === 'known').map(([word]) => word);
  return Array.from(new Set([...fromVocab, ...fromStates, ...syncKnown].map((word) => word.toLowerCase())));
}
