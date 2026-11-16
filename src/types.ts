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
  source: 'sample' | 'epub' | 'text' | 'pdf';
  /** 每页对应的扫描图路径（page number → image url）。存在即可切换「看图」模式。 */
  pageImages?: Record<number, string>;
  /** 每页 OCR 文本块坐标（Vision 归一化坐标，原点左下）。用于图片模式的点词查义。 */
  pageBlocks?: Record<number, { x: number; y: number; w: number; h: number; text: string }[]>;
  /** 有声书音频路径。存在即可在阅读页显示音频条。 */
  audio?: string;
  /** 从 EPUB 提取并压缩后的真实封面（data URL）。存在时书库优先展示它而非生成封面。 */
  coverImage?: string;
  /** CEFR 分级标签（A1–B2），用于分级入门书架与难度展示。 */
  level?: string;
  /** 用户自定义标签（收藏集），用于书库筛选与组织。旧数据无此字段时回退 []。 */
  tags?: string[];
}

/** 书库「保存的视图」：把当前的搜索 / 排序 / 筛选 / 标签组合存成命名视图，一键复用。 */
export interface LibraryView {
  id: string;
  name: string;
  query: string;
  sortMode: 'default' | 'match';
  onlyIdeal: boolean;
  tag: string;
}

/** 课程播放列表：把多本带音频的书/课程排成队列连续播放（LingQ playlist）。旧备份无此字段时回退 []。 */
export interface Playlist {
  id: string;
  name: string;
  /** 有序 bookId 队列；播放时按序解析音频，无音频的书自动跳过。 */
  bookIds: string[];
  createdAt: string;
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
  /** 多词短语 / 习语（如 "give up"）。为 true 时 word 是整个短语，复习按整块挖空，听写跳过。 */
  isPhrase?: boolean;
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
  mode: 'flashcard' | 'cloze' | 'sentence' | 'dictation';
  createdAt: string;
}

export interface ReaderSettings {
  fontSize: number;
  lineHeight: number;
  theme: ReaderTheme;
  reducedAmbient: boolean;
  /** 常驻注音模式：off 关闭 / learning 仅学习中 / all 全部有释义的词。旧数据无此字段时回退 learning。 */
  annotationMode?: 'off' | 'learning' | 'all';
  /** 每日学习目标（学习动作数：查词标记/收藏/复习/跟读）。旧数据回退 5。 */
  dailyGoal?: number;
}

/** 词状态：new（未标记，默认）/ learning（学习中，显示注音）/ known（已掌握，移除注音）。 */
export type WordState = 'learning' | 'known';

/** 常驻注音用的简短释义缓存（查词 / 标记时写入），避免每次渲染都请求词典。 */
export interface WordGloss {
  zh: string;
  phonetic?: string;
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
  /** 词状态 map（word→learning/known）。旧备份无此字段时回退 {}。 */
  wordStates?: Record<string, WordState>;
  /** 常驻注音释义缓存（word→{zh,phonetic}）。旧备份无此字段时回退 {}。 */
  glosses?: Record<string, WordGloss>;
  /** 书库保存的视图。旧备份无此字段时回退 []。 */
  libraryViews?: LibraryView[];
  /** 课程播放列表。旧备份无此字段时回退 []。 */
  playlists?: Playlist[];
  /** 单调递增的数据修订号：跨标签页同步用来判断哪份快照更新，避免旧标签页整份覆盖新数据。旧备份无此字段时回退 0。 */
  rev?: number;
  /** 删除墓碑（记录 id → 删除时刻 ms）：跨标签页按 id 并集合并时，据此让删除能传播、又不误伤撤销复活。旧备份无此字段时回退 {}。 */
  tombstones?: Record<string, number>;
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
