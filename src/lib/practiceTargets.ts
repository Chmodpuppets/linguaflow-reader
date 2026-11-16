import type { Book, Highlight, SavedSentence, VoiceMode } from '../types';

/** 练习目标来源分组：用户收藏句 > 用户标记 > 书中段落（非收藏，兜底参考）。 */
export type TargetGroup = 'sentence' | 'highlight' | 'paragraph';

export interface PracticeTarget {
  id: string;
  text: string;
  bookId?: string;
  noteId?: string;
  audioUrl?: string;
  source: string;
  group: TargetGroup;
}

/** 书中段落作为练习目标的长度窗口（太短/太长都不适合跟读复述）。 */
const PARAGRAPH_MIN = 35;
const PARAGRAPH_MAX = 650;
/** 书中段落候选上限：避免整本书的原文把用户自己的收藏淹没。 */
const PARAGRAPH_CAP = 60;
const TOTAL_CAP = 200;

function normKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * 构建口语实验室的练习目标列表。
 * 顺序与优先级：① 用户收藏句（saved sentences）② 用户标记（highlights）③ 书中段落。
 * 按文本去重（收藏句优先），书中段落限量并排在最后——用户自己的内容永远在最前、不会被原文刷屏。
 * 纯函数，便于单测。
 */
export function buildPracticeTargets(
  books: Book[],
  highlights: Highlight[],
  sentences: SavedSentence[],
  mode: VoiceMode,
): PracticeTarget[] {
  if (mode === 'freetalk') return [];
  const seen = new Set<string>();
  const out: PracticeTarget[] = [];
  const push = (target: PracticeTarget) => {
    const key = normKey(target.text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(target);
  };

  // ① 用户收藏句（最优先）
  for (const sentence of sentences) {
    const book = books.find((candidate) => candidate.id === sentence.bookId);
    push({
      id: `sentence-${sentence.id}`,
      text: sentence.text,
      bookId: sentence.bookId,
      audioUrl: book?.audio,
      source: sentence.bookTitle || '我的收藏句',
      group: 'sentence',
    });
  }

  // ② 用户标记
  for (const item of highlights) {
    const book = books.find((candidate) => candidate.id === item.bookId);
    push({
      id: item.id,
      text: item.text,
      bookId: item.bookId,
      noteId: item.id,
      audioUrl: book?.audio,
      source: book?.title || '我的标记',
      group: 'highlight',
    });
  }

  // ③ 书中段落（非收藏，兜底参考；限量、排最后）
  const paragraphs = books.flatMap((book) =>
    book.chapters.flatMap((chapter) =>
      chapter.paragraphs
        .map((text, index) => ({ text, index, chapter, book }))
        .filter((item) => item.text.length > PARAGRAPH_MIN && item.text.length < PARAGRAPH_MAX),
    ),
  );
  for (const item of paragraphs.slice(0, PARAGRAPH_CAP)) {
    push({
      id: `${item.book.id}-${item.chapter.id}-${item.index}`,
      text: item.text,
      bookId: item.book.id,
      audioUrl: item.book.audio,
      source: `${item.book.title} · ${item.chapter.title}`,
      group: 'paragraph',
    });
  }

  return out.slice(0, TOTAL_CAP);
}
