import type { Book, Chapter } from '../types';
import { makeId } from './utils';
import { buildBookFromText } from './textBook';
import { MAX_ALIGN_BYTES, buildBookAlignment, transcribeAudioTimed, type AlignProgress, type AlignedLine, type BookAlignment } from './bookAlignment';
import type { TimedChunk } from './whisperTypes';
import type { WhisperModelId } from './whisper';
import { saveAlignment, saveBookAudio } from './db';
import { registerAlignment } from './audioAlign';
import { notifyBookAudioChanged } from './bookAudio';
import { cuesToChunks, type SubtitleCue } from './subtitle';

// ── 音频 + 文本一键建课 ───────────────────────────────────────────────────────
// 把「一段音频（+ 可选文稿）」一步变成可阅读、可点词、可句级跟读定位的课程：
//   · 有文稿：文本建书 → 本地 Whisper 转写音频 → 与文稿对齐（buildBookAlignment）。
//   · 无文稿：本地 Whisper 直接把音频转写成带时间戳的句子 → 既当正文又当时间轴，
//     文本与音频天然逐句对应，无需再做模糊对齐。
// 音频与对齐结果存 IndexedDB（不进 JSON 备份、不上传），书本身进 AppData。

export interface BuildLessonOptions {
  title?: string;
  /** 可选文稿：提供则走「文本 + 音频对齐」，更贴合原文；不提供则纯转写。 */
  text?: string;
  onProgress?: (progress: AlignProgress) => void;
  isCancelled?: () => boolean;
  model?: WhisperModelId;
}

export interface LessonResult {
  book: Book;
  alignment: BookAlignment;
  mode: 'transcribed' | 'aligned' | 'subtitle';
}

/** 把转写句子按 perGroup 句合并成自然段（音频逐句太碎，合并后更易读）。纯函数。 */
export function groupChunksToParagraphs(chunks: TimedChunk[], perGroup = 3): string[] {
  const paragraphs: string[] = [];
  for (let i = 0; i < chunks.length; i += perGroup) {
    const text = chunks.slice(i, i + perGroup).map((chunk) => chunk.text.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (text) paragraphs.push(text);
  }
  return paragraphs;
}

/** 转写句子 → 章节（每 ~12 段一个 Part，短音频单章）。纯函数。 */
export function chunksToChapters(id: string, chunks: TimedChunk[]): Chapter[] {
  const paragraphs = groupChunksToParagraphs(chunks);
  if (!paragraphs.length) return [];
  const PER_CHAPTER = 12;
  const chapters: Chapter[] = [];
  for (let i = 0; i < paragraphs.length; i += PER_CHAPTER) {
    const slice = paragraphs.slice(i, i + PER_CHAPTER);
    const index = chapters.length;
    chapters.push({ id: `${id}-ch-${index}`, title: paragraphs.length > PER_CHAPTER ? `Part ${index + 1}` : '课文', paragraphs: slice });
  }
  return chapters;
}

/** 转写句子 → 句级时间轴（文本即来自音频，天然对齐）。纯函数。 */
export function chunksToAlignedLines(chunks: TimedChunk[]): AlignedLine[] {
  const seen = new Set<string>();
  const lines: AlignedLine[] = [];
  for (const chunk of chunks) {
    const text = chunk.text.trim().replace(/\s+/g, ' ');
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({ t: text, s: Math.max(0, chunk.start), e: Math.max(chunk.start + 0.25, chunk.end) });
  }
  return lines;
}

const ACCENTS = ['#0ea5e9', '#7c5cff', '#10b981', '#f59e0b', '#ec4899'];

/** 一键建课：音频（+ 可选文稿）→ 书 + 绑定音频 + 句级对齐，全部落盘后返回。 */
export async function buildLesson(audio: Blob, options: BuildLessonOptions = {}): Promise<LessonResult> {
  const { onProgress, isCancelled } = options;
  if (audio.size > MAX_ALIGN_BYTES) {
    throw new Error(`音频 ${(audio.size / 1048576).toFixed(1)}MB 超过 ${MAX_ALIGN_BYTES / 1048576}MB 上限。请剪出要练的片段再建课。`);
  }
  const id = makeId('book');
  const title = options.title?.trim() || '音频课程';
  let book: Book;
  let alignment: BookAlignment;
  let mode: LessonResult['mode'];

  const transcript = options.text?.trim();
  if (transcript) {
    // 有文稿：文本建书 → 音频转写 → 与文稿对齐。
    book = buildBookFromText(title, '', transcript, id);
    alignment = await buildBookAlignment(book, audio, { onProgress, isCancelled, model: options.model });
    mode = 'aligned';
  } else {
    // 无文稿：纯转写，句子既当正文又当时间轴。
    const { chunks, duration } = await transcribeAudioTimed(audio, { onProgress, isCancelled, model: options.model });
    if (isCancelled?.()) throw new Error('已取消');
    const clean = chunks.map((chunk) => ({ ...chunk, text: chunk.text.trim() })).filter((chunk) => chunk.text.length > 0);
    const lines = chunksToAlignedLines(clean);
    if (lines.length < 2) throw new Error('没有从音频里识别到足够的语句。请确认音频里有清晰的英文朗读，或换用更长的片段。');
    onProgress?.({ phase: 'align', progress: 60, label: '整理课文与时间轴…' });
    const chapters = chunksToChapters(id, clean);
    book = {
      id,
      title,
      author: '音频转写',
      description: `由音频本地转写建课 · ${chapters.length} 个章节 · ${lines.length} 句`,
      cover: '',
      accent: ACCENTS[Math.floor(Math.random() * ACCENTS.length)],
      chapters,
      progress: 0,
      currentChapter: 0,
      currentParagraph: 0,
      addedAt: new Date().toISOString(),
      source: 'text',
    };
    alignment = { version: 1, bookId: id, createdAt: new Date().toISOString(), duration, lineCount: lines.length, lines };
    mode = 'transcribed';
  }

  book.tags = [...(book.tags || []), '音频建课'];
  onProgress?.({ phase: 'save', progress: 90, label: '保存音频与句级定位…' });
  await saveBookAudio(id, audio);
  await saveAlignment(id, alignment);
  registerAlignment(id, alignment.lines);
  notifyBookAudioChanged(id);
  onProgress?.({ phase: 'done', progress: 100, label: '课程已就绪' });
  return { book, alignment, mode };
}

export interface SubtitleLessonOptions {
  title?: string;
  /** 可选配套音频/视频：提供则绑定供播放；不提供也能阅读 + 拥有精确时间轴（之后可再绑音频）。 */
  audio?: Blob;
  onProgress?: (progress: AlignProgress) => void;
}

/**
 * 字幕一键建课：SRT/VTT 字幕句自带精确起止时间 → 书 + 句级时间轴，无需语音识别。
 * 配套音频可选：有则绑定播放，无则仍可阅读、点词、看时间轴（日后可在阅读器里补绑音频）。
 */
export async function buildLessonFromSubtitles(cues: SubtitleCue[], options: SubtitleLessonOptions = {}): Promise<LessonResult> {
  const { onProgress, audio } = options;
  const chunks = cuesToChunks(cues);
  const lines = chunksToAlignedLines(chunks);
  if (lines.length < 2) throw new Error('字幕里没有足够的语句。请确认是有效的 SRT / VTT 字幕文件。');
  if (audio && audio.size > MAX_ALIGN_BYTES) {
    throw new Error(`音频 ${(audio.size / 1048576).toFixed(1)}MB 超过 ${MAX_ALIGN_BYTES / 1048576}MB 上限。请剪出要练的片段再建课。`);
  }
  onProgress?.({ phase: 'align', progress: 50, label: '整理课文与时间轴…' });
  const id = makeId('book');
  const title = options.title?.trim() || '字幕课程';
  const chapters = chunksToChapters(id, chunks);
  const duration = cues.reduce((max, cue) => Math.max(max, cue.end), 0);
  const book: Book = {
    id,
    title,
    author: '字幕建课',
    description: `由字幕建课 · ${chapters.length} 个章节 · ${lines.length} 句 · 精确时间轴`,
    cover: '',
    accent: ACCENTS[Math.floor(Math.random() * ACCENTS.length)],
    chapters,
    progress: 0,
    currentChapter: 0,
    currentParagraph: 0,
    addedAt: new Date().toISOString(),
    source: 'text',
    tags: ['字幕建课'],
  };
  const alignment: BookAlignment = { version: 1, bookId: id, createdAt: new Date().toISOString(), duration, lineCount: lines.length, lines };
  onProgress?.({ phase: 'save', progress: 90, label: audio ? '保存音频与句级定位…' : '保存句级定位…' });
  if (audio) await saveBookAudio(id, audio);
  await saveAlignment(id, alignment);
  registerAlignment(id, alignment.lines);
  notifyBookAudioChanged(id);
  onProgress?.({ phase: 'done', progress: 100, label: '课程已就绪' });
  return { book, alignment, mode: 'subtitle' };
}
