// ── 句子级上下文 ────────────────────────────────────────────────────────────────
// 查词面板默认只展示「包含该词的那一句」，而不是整段原文：整段太长会把释义挤出首屏，
// 也不利于收藏。这里提供纯函数做句子切分 / 定位 / 高亮切片，便于单元测试与三产品复用。

import type { SavedSentence, VocabEntry } from '../types';

/** 转义正则特殊字符，保证用户词（含撇号 / 连字符）能安全进正则。 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 句子 = 一串非句末标点 + 句末标点（.!?…，可带收尾引号/括号）；段尾无标点也成一句。
const SENTENCE_RE = /[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/g;

/** 把段落切成句子（trim、去空）。无句末标点时整段作为一句返回。 */
export function splitSentences(paragraph: string): string[] {
  const matches = paragraph.match(SENTENCE_RE) || [];
  return matches.map((sentence) => sentence.trim()).filter(Boolean);
}

function wordBoundary(word: string): RegExp {
  return new RegExp(`(^|[^a-zA-Z])${escapeRegExp(word)}([^a-zA-Z]|$)`, 'i');
}

/**
 * 提取包含目标词的那一句。优先整词边界匹配（避免 chapter 命中 chapters 的子串误判优先），
 * 退而求其次用包含匹配；都没有时回退第一句，保证面板永远有一句可展示 / 可收藏。
 */
export function extractSentence(paragraph: string, word: string): string {
  const sentences = splitSentences(paragraph);
  if (!sentences.length) return paragraph.trim();
  const target = word.toLowerCase().trim();
  if (!target) return sentences[0];
  const boundary = wordBoundary(target);
  const exact = sentences.find((sentence) => boundary.test(sentence));
  if (exact) return exact;
  const loose = sentences.find((sentence) => sentence.toLowerCase().includes(target));
  return loose || sentences[0];
}

/** 把句子按目标词切成「普通 / 命中」片段，供渲染时高亮该词（不区分大小写、整词边界）。 */
export function sentenceParts(sentence: string, word: string): { text: string; hit: boolean }[] {
  const target = word.trim();
  if (!target) return [{ text: sentence, hit: false }];
  const pattern = new RegExp(`(^|[^a-zA-Z])(${escapeRegExp(target)})(?=[^a-zA-Z]|$)`, 'gi');
  const parts: { text: string; hit: boolean }[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sentence))) {
    const start = match.index + match[1].length;
    if (start > last) parts.push({ text: sentence.slice(last, start), hit: false });
    parts.push({ text: match[2], hit: true });
    last = start + match[2].length;
  }
  if (last < sentence.length) parts.push({ text: sentence.slice(last), hit: false });
  return parts.length ? parts : [{ text: sentence, hit: false }];
}

/**
 * 把收藏的句子映射成复习用的「合成词条」，复用挖空 / 反馈渲染：
 * context=整句、word=触发词、dictionary.chinese/meaning=收藏时释义。
 * id 保留句子 id，便于复习页回查原句并把结果记到对应单词的 SRS。
 */
export function sentenceToReviewEntry(sentence: SavedSentence): VocabEntry {
  return {
    id: sentence.id,
    word: sentence.word,
    context: sentence.text,
    bookId: sentence.bookId,
    bookTitle: sentence.bookTitle,
    chapterId: sentence.chapterId,
    chapterTitle: sentence.chapterTitle,
    paragraphIndex: sentence.paragraphIndex,
    note: '',
    dictionary: { word: sentence.word, phonetic: sentence.phonetic, partOfSpeech: '', meaning: sentence.meaning, chinese: sentence.meaning, usage: '', example: '', exampleCn: '', synonyms: [] },
    createdAt: sentence.createdAt,
    familiarity: 0,
    dueAt: sentence.createdAt,
    reviewCount: 0,
  };
}
