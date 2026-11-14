// Voice Lab v2 · Tier 3 ⑥：复杂度维度（CAF 中的 Complexity）。
// Free Talk 统计句长 / 从句 / 词汇多样性（TTR）。纯前端、不新增模型。
// 诚实边界：复杂度只描述句子结构，≠ 说得更好；准确与可懂度优先。

import { splitSentences } from './sentence';

export type ComplexityLevel = 'simple' | 'developing' | 'rich';

export interface Complexity {
  wordCount: number;
  sentenceCount: number;
  avgSentenceLen: number;
  clauseCount: number;
  clausePerSentence: number;
  ttr: number;
  level: ComplexityLevel;
}

const CLAUSE_RE = /\b(because|although|though|when|while|if|unless|since|whereas|that|which|who|whom|whose|after|before|until|as)\b/gi;

export function complexityOf(text: string): Complexity {
  const words = (text.toLowerCase().match(/[a-z']+/g) || []);
  const wordCount = words.length;
  const sentences = splitSentences(text).filter((s) => s.trim().length > 0);
  const sentenceCount = Math.max(1, sentences.length);
  const clauseCount = (text.match(CLAUSE_RE) || []).length;
  const unique = new Set(words).size;
  const avgSentenceLen = wordCount / sentenceCount;
  const clausePerSentence = clauseCount / sentenceCount;
  const ttr = wordCount ? unique / wordCount : 0;
  const level: ComplexityLevel =
    avgSentenceLen >= 12 && clausePerSentence >= 0.5 ? 'rich'
    : avgSentenceLen >= 8 || clausePerSentence >= 0.3 ? 'developing'
    : 'simple';
  return { wordCount, sentenceCount, avgSentenceLen, clauseCount, clausePerSentence, ttr, level };
}

export function complexitySuggestion(c: Complexity): string {
  if (c.wordCount === 0) return '先开口说几句，复杂度才有意义。';
  if (c.level === 'simple') return '下一轮：试着用 because / when 把两个短句连成一句。';
  if (c.level === 'developing') return '下一轮：加一个 although / which 从句，让意思更细。';
  return '复杂度已经不错。下一轮关注准确与流畅，而不是更长。';
}

export const COMPLEXITY_NOTE = '复杂度只描述句子结构，不代表说得更好；准确与可懂度优先。';
