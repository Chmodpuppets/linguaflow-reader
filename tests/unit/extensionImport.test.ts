import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeImportedItems, type ExtensionItem } from '../../src/lib/extensionImport';
import type { AppData, VocabEntry } from '../../src/types';

const settings = { fontSize: 18, lineHeight: 1.8, theme: 'midnight', reducedAmbient: false } as AppData['settings'];
const base: AppData = { books: [], vocabulary: [], highlights: [], reviewLogs: [], voiceRecords: [], settings };

function item(over: Partial<ExtensionItem> = {}): ExtensionItem {
  return {
    id: 'ext-1', kind: 'word', text: 'serendipity', context: 'It was pure serendipity.',
    sourceUrl: 'https://example.com/article', sourceTitle: 'Example', createdAt: '2026-11-16T00:00:00Z', ...over,
  };
}

test('单词条目并入词汇本：来源网页、语境、SRS 初始字段齐全', () => {
  const { data, added, ids } = mergeImportedItems(base, [item()]);
  assert.equal(added, 1);
  assert.deepEqual(ids, ['ext-1']);
  const entry = data.vocabulary[0];
  assert.equal(entry.word, 'serendipity');
  assert.equal(entry.bookId, 'web');
  assert.equal(entry.chapterTitle, '网页收藏');
  assert.equal(entry.note, 'https://example.com/article');
  assert.equal(entry.context, 'It was pure serendipity.');
  assert.equal(entry.familiarity, 0);
  assert.equal(entry.reviewCount, 0);
  assert.equal(entry.isPhrase, undefined);
});

test('短语条目带 isPhrase 标记', () => {
  const { data, added } = mergeImportedItems(base, [item({ id: 'p1', kind: 'phrase', text: 'give up' })]);
  assert.equal(added, 1);
  assert.equal(data.vocabulary[0].isPhrase, true);
  assert.equal(data.vocabulary[0].word, 'give up');
});

test('句子条目并入句子收藏（不进词汇本）', () => {
  const { data, added } = mergeImportedItems(base, [item({ id: 's1', kind: 'sentence', text: 'A full sentence.', context: '' })]);
  assert.equal(added, 1);
  assert.equal(data.vocabulary.length, 0);
  assert.equal(data.sentences?.length, 1);
  assert.equal(data.sentences?.[0].text, 'A full sentence.');
  assert.equal(data.sentences?.[0].bookTitle, 'Example');
  assert.equal(data.sentences?.[0].chapterTitle, '网页收藏');
});

test('单词按归一化去重：已存在的词不再新增', () => {
  const existing: VocabEntry = { id: 'v', word: 'hello', context: '', bookId: 'b', bookTitle: 'B', chapterId: 'c', chapterTitle: 'C', paragraphIndex: 0, note: '', createdAt: '2026-01-01T00:00:00Z', familiarity: 2, dueAt: '2026-01-01T00:00:00Z', reviewCount: 3 };
  const local: AppData = { ...base, vocabulary: [existing] };
  const { added, ids } = mergeImportedItems(local, [item({ id: 'dup', text: 'Hello' })]);
  assert.equal(added, 0);
  assert.deepEqual(ids, []);
});

test('短语按短语键去重、句子按文本去重', () => {
  const local: AppData = {
    ...base,
    vocabulary: [{ id: 'vp', word: 'give up', isPhrase: true, context: '', bookId: 'b', bookTitle: 'B', chapterId: 'c', chapterTitle: 'C', paragraphIndex: 0, note: '', createdAt: '2026-01-01T00:00:00Z', familiarity: 0, dueAt: '2026-01-01T00:00:00Z', reviewCount: 0 }],
    sentences: [{ id: 'ss', text: 'Same sentence.', word: '', meaning: '', phonetic: '', bookId: 'b', bookTitle: 'B', chapterId: 'c', chapterTitle: 'C', paragraphIndex: 0, createdAt: '2026-01-01T00:00:00Z' }],
  };
  const { added } = mergeImportedItems(local, [
    item({ id: 'p', kind: 'phrase', text: 'Give  Up' }),
    item({ id: 's', kind: 'sentence', text: 'Same sentence.' }),
  ]);
  assert.equal(added, 0);
});

test('非法条目（空文本 / 未知 kind）被忽略', () => {
  const { added } = mergeImportedItems(base, [
    item({ id: 'a', text: '   ' }),
    item({ id: 'b', kind: 'bogus' as ExtensionItem['kind'] }),
    { id: 'c', kind: 'word', text: 'ok', context: '', sourceUrl: '', sourceTitle: '', createdAt: '' },
  ]);
  assert.equal(added, 1);
});

test('语境缺失时回退到条目文本', () => {
  const { data } = mergeImportedItems(base, [item({ context: '  ' })]);
  assert.equal(data.vocabulary[0].context, 'serendipity');
});
