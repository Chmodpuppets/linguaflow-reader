import type { WordGloss, WordState } from '../types';

export type AnnotationMode = 'off' | 'learning' | 'all';

/** 提取段落中的英文词（小写、去重），用于覆盖率统计。 */
export function chapterWords(paragraphs: string[]): string[] {
  const seen = new Set<string>();
  for (const paragraph of paragraphs) {
    for (const match of paragraph.match(/[a-zA-Z][a-zA-Z'-]*/g) || []) {
      const word = match.toLowerCase();
      if (word.length >= 2) seen.add(word);
    }
  }
  return [...seen];
}

/** 某个词在当前模式下是否应显示常驻注音，返回简短中文释义或 null。 */
export function rubyGlossFor(word: string, mode: AnnotationMode, states: Record<string, WordState>, glosses: Record<string, WordGloss>): string | null {
  if (mode === 'off') return null;
  const key = word.toLowerCase();
  const state = states[key];
  const gloss = glosses[key];
  if (!gloss || !gloss.zh) return null;
  if (state === 'known') return mode === 'all' ? gloss.zh : null;
  if (state === 'learning') return gloss.zh;
  // 未标记（new）的词：仅在 all 模式下且有释义时提示。
  return mode === 'all' ? gloss.zh : null;
}

export interface ChapterStats {
  total: number;
  known: number;
  learning: number;
  coveragePct: number;
  barePct: number;
}

/** 当前章的掌握 / 学习 / 覆盖率 / 裸页率，让「逐渐裸页」的进步可感知。 */
export function chapterStats(paragraphs: string[], states: Record<string, WordState>, glosses: Record<string, WordGloss>, mode: AnnotationMode): ChapterStats {
  const words = chapterWords(paragraphs);
  let known = 0;
  let learning = 0;
  let annotated = 0;
  for (const word of words) {
    const state = states[word];
    if (state === 'known') known++;
    else if (state === 'learning') learning++;
    if (rubyGlossFor(word, mode, states, glosses)) annotated++;
  }
  const total = words.length || 1;
  return {
    total: words.length,
    known,
    learning,
    coveragePct: Math.round((known / total) * 100),
    barePct: Math.round(((words.length - annotated) / total) * 100),
  };
}
