export type Page = 'library' | 'vocabulary' | 'review' | 'voice-lab' | 'voice-analytics' | 'notes' | 'settings';
export type ReaderTheme = 'midnight' | 'sepia' | 'paper';

export interface Chapter {
  id: string;
  title: string;
  paragraphs: string[];
}

export interface Book {
  id: string;
  title: string;
  author: string;
  description: string;
  cover: string;
  accent: string;
  chapters: Chapter[];
  progress: number;
  currentChapter: number;
  currentParagraph: number;
  addedAt: string;
  lastReadAt?: string;
  source: 'sample' | 'epub';
  /** 每页对应的扫描图路径（page number → image url）。存在即可切换「看图」模式。 */
  pageImages?: Record<number, string>;
  /** 每页 OCR 文本块坐标（Vision 归一化坐标，原点左下）。用于图片模式的点词查义。 */
  pageBlocks?: Record<number, { x: number; y: number; w: number; h: number; text: string }[]>;
  /** 有声书音频路径。存在即可在阅读页显示音频条。 */
  audio?: string;
}

export interface DictionaryEntry {
  word: string;
  phonetic: string;
  partOfSpeech: string;
  meaning: string;
  chinese: string;
  usage: string;
  example: string;
  exampleCn: string;
  synonyms: string[];
}

export interface VocabEntry {
  id: string;
  word: string;
  context: string;
  bookId: string;
  bookTitle: string;
  chapterId: string;
  chapterTitle: string;
  paragraphIndex: number;
  note: string;
  dictionary?: DictionaryEntry;
  createdAt: string;
  familiarity: number;
  dueAt: string;
  reviewCount: number;
  spokenCount?: number;
  lastSpokenAt?: string;
}

export interface Highlight {
  id: string;
  bookId: string;
  chapterId: string;
  paragraphIndex: number;
  text: string;
  /** 划选处在段落内的字符偏移。同段出现重复文本时靠它定位实际划选处；旧数据无此字段时回退 indexOf。 */
  offset?: number;
  note: string;
  color: 'violet' | 'cyan' | 'amber';
  createdAt: string;
}

/** 收藏的句子：查词面板里「收藏句子」保存的整句 + 当时的释义，供笔记页回顾 / 朗读 / 回原文。 */
export interface SavedSentence {
  id: string;
  /** 包含所查单词的那一句（不是整段）。 */
  text: string;
  /** 触发收藏的单词。 */
  word: string;
  /** 收藏时的词典主释义（服务器为中文，免费词典为英文）。 */
  meaning: string;
  phonetic: string;
  bookId: string;
  bookTitle: string;
  chapterId: string;
  chapterTitle: string;
  paragraphIndex: number;
  createdAt: string;
}

export interface ReviewLog {
  id: string;
  vocabId: string;
  result: 'again' | 'hard' | 'good' | 'easy';
  mode: 'flashcard' | 'cloze';
  createdAt: string;
}

export interface ReaderSettings {
  fontSize: number;
  lineHeight: number;
  theme: ReaderTheme;
  reducedAmbient: boolean;
}

export type VoiceMode = 'shadowing' | 'retell' | 'freetalk';
export type DiffStatus = 'match' | 'low' | 'missing' | 'substitute' | 'extra';

export interface DiffToken {
  text: string;
  status: DiffStatus;
  confidence?: number;
  spoken?: string;
}

export interface VoiceMetrics {
  wpm: number;
  pauseRatio: number;
  accuracy: number;
  duration: number;
  wordCount: number;
  fillerCount: number;
}

export interface VoiceRecord {
  id: string;
  bookId?: string;
  noteId?: string;
  mode: VoiceMode;
  targetText: string;
  transcript: string;
  diffTokens: DiffToken[];
  metrics: VoiceMetrics;
  createdAt: string;
}

export interface AppData {
  books: Book[];
  vocabulary: VocabEntry[];
  highlights: Highlight[];
  reviewLogs: ReviewLog[];
  voiceRecords: VoiceRecord[];
  /** 收藏的句子（旧备份可能没有该字段，读取时回退 []）。 */
  sentences?: SavedSentence[];
  settings: ReaderSettings;
}

export interface SelectionState {
  text: string;
  context: string;
  bookId: string;
  chapterId: string;
  paragraphIndex: number;
  /** 划选起点在段落内的字符偏移，用于重复文本的精确定位。 */
  offset?: number;
  x: number;
  y: number;
}
