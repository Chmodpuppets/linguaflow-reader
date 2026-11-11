import type { AppData, VocabEntry } from '../types';
import { lookupWord } from './dictionary';
import { sampleBooks } from './sampleBooks';

const seedWords = ['attention', 'curiosity', 'deliberate', 'fleeting'];
const seedVocabulary: VocabEntry[] = seedWords.map((word, index) => ({
  id: `seed-${word}`,
  word,
  context: sampleBooks[0].chapters[index < 2 ? 0 : index === 2 ? 0 : 2].paragraphs[index === 0 ? 0 : index === 1 ? 2 : index === 2 ? 0 : 1],
  bookId: sampleBooks[0].id,
  bookTitle: sampleBooks[0].title,
  chapterId: sampleBooks[0].chapters[index < 2 ? 0 : index === 2 ? 0 : 2].id,
  chapterTitle: sampleBooks[0].chapters[index < 2 ? 0 : index === 2 ? 0 : 2].title,
  paragraphIndex: index === 0 ? 0 : index === 1 ? 2 : index === 2 ? 0 : 1,
  note: '',
  dictionary: lookupWord(word),
  createdAt: `2026-10-${22 + index}T08:00:00.000Z`,
  familiarity: index % 3,
  dueAt: '2026-10-27T00:00:00.000Z',
  reviewCount: index,
}));

export const initialData: AppData = {
  books: sampleBooks,
  vocabulary: seedVocabulary,
  highlights: [{ id: 'seed-highlight', bookId: 'art-of-noticing', chapterId: 'noticing-1', paragraphIndex: 4, text: 'The world is not finished being interesting.', note: '也许“保持好奇”不是天赋，而是愿意修改自己对世界的描述。', color: 'violet', createdAt: '2026-10-26T12:00:00.000Z' }],
  reviewLogs: [],
  voiceRecords: [],
  sentences: [{ id: 'seed-sentence', text: 'The world is not finished being interesting.', word: 'interesting', meaning: 'a. 有趣的, 引起好奇心的, 有意义的', phonetic: "'intristiŋ", bookId: 'art-of-noticing', bookTitle: 'The Art of Noticing', chapterId: 'noticing-1', chapterTitle: 'The world is not finished', paragraphIndex: 4, createdAt: '2026-10-26T12:00:00.000Z' }],
  settings: { fontSize: 19, lineHeight: 1.8, theme: 'midnight', reducedAmbient: true },
};
