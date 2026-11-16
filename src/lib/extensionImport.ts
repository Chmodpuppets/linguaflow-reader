import type { AppData, SavedSentence, VocabEntry } from '../types';
import { normalizeWord } from '../data/dictionary';
import { phraseKey } from './phrase';

/**
 * 浏览器扩展 → 阅读器的收藏导入协议与合并逻辑。
 *
 * 扩展在任意网页划选词/短语/句子，经 background 队列 + reader 同源 bridge content script
 * 以 window.postMessage 投递到本页；本页用 mergeImportedItems 并入词汇本/句子收藏，
 * 再走正常的 rev 写盘 + 跨标签广播。所有数据逻辑集中在阅读器一侧（单一事实来源），
 * 扩展只负责采集与传输。纯函数，便于单测。
 */

/** 与 extension/lib.js 的 LFExt.SOURCE 保持一致。 */
export const LF_EXT_SOURCE = 'linguaflow-extension';

export interface ExtensionItem {
  /** 扩展生成的稳定 id，用于去重与回执。 */
  id: string;
  kind: 'word' | 'phrase' | 'sentence';
  /** 词 / 短语 / 句子本身。 */
  text: string;
  /** 所在原句（词/短语时是上下文句；句子时等于 text）。 */
  context: string;
  sourceUrl: string;
  sourceTitle: string;
  createdAt: string;
}

export interface ExtensionImportMessage {
  source: typeof LF_EXT_SOURCE;
  type: 'lf-import';
  items: ExtensionItem[];
}

export interface ExtensionImportAck {
  source: typeof LF_EXT_SOURCE;
  type: 'lf-imported';
  ids: string[];
}

const WEB_BOOK_ID = 'web';
const WEB_CHAPTER_ID = 'web';
const WEB_CHAPTER_TITLE = '网页收藏';

function firstWord(text: string): string {
  const match = text.match(/[A-Za-z][A-Za-z'-]*/);
  return match ? match[0] : text;
}

function isValidItem(item: unknown): item is ExtensionItem {
  if (!item || typeof item !== 'object') return false;
  const candidate = item as Record<string, unknown>;
  return typeof candidate.id === 'string'
    && typeof candidate.text === 'string'
    && (candidate.kind === 'word' || candidate.kind === 'phrase' || candidate.kind === 'sentence');
}

/**
 * 把扩展投递的收藏并入数据：词/短语进词汇本（按归一词/短语键去重），句子进句子收藏（按文本去重）。
 * 只新增、不覆盖既有记录；返回新增数量与已采纳的扩展 id（供回执清队列）。
 */
export function mergeImportedItems(data: AppData, items: ExtensionItem[]): { data: AppData; added: number; ids: string[] } {
  const vocabulary: VocabEntry[] = [...data.vocabulary];
  const sentences: SavedSentence[] = [...(data.sentences || [])];
  const existingWords = new Set(vocabulary.map((entry) => (entry.isPhrase ? phraseKey(entry.word) : normalizeWord(entry.word))));
  const existingSentences = new Set(sentences.map((sentence) => sentence.text.trim().toLowerCase()));
  const ids: string[] = [];
  let added = 0;

  for (const raw of items.slice(0, 200)) {
    if (!isValidItem(raw)) continue;
    const item = raw;
    const text = item.text.trim();
    if (!text) continue;
    const createdAt = item.createdAt || new Date().toISOString();
    const bookTitle = item.sourceTitle?.trim() || '网页收藏';

    if (item.kind === 'sentence') {
      const key = text.toLowerCase();
      if (existingSentences.has(key)) continue;
      existingSentences.add(key);
      sentences.unshift({
        id: `sentence-${item.id}`, text, word: firstWord(text), meaning: '', phonetic: '',
        bookId: WEB_BOOK_ID, bookTitle, chapterId: WEB_CHAPTER_ID, chapterTitle: WEB_CHAPTER_TITLE,
        paragraphIndex: 0, createdAt,
      });
      ids.push(item.id); added += 1;
      continue;
    }

    const isPhrase = item.kind === 'phrase';
    const key = isPhrase ? phraseKey(text) : normalizeWord(text);
    if (!key || existingWords.has(key)) continue;
    existingWords.add(key);
    vocabulary.unshift({
      id: `vocab-${item.id}`, word: text, isPhrase: isPhrase || undefined,
      context: item.context?.trim() || text, bookId: WEB_BOOK_ID, bookTitle,
      chapterId: WEB_CHAPTER_ID, chapterTitle: WEB_CHAPTER_TITLE, paragraphIndex: 0,
      note: item.sourceUrl || '', createdAt, familiarity: 0, dueAt: createdAt, reviewCount: 0,
    });
    ids.push(item.id); added += 1;
  }

  return { data: { ...data, vocabulary, sentences }, added, ids };
}
