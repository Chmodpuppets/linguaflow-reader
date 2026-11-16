import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSnapshots } from '../../src/lib/dataMerge';
import type { AppData, Highlight, SavedSentence, VocabEntry } from '../../src/types';

const settings = { fontSize: 18, lineHeight: 1.8, theme: 'midnight', reducedAmbient: false } as AppData['settings'];
const base: AppData = { books: [], vocabulary: [], highlights: [], reviewLogs: [], voiceRecords: [], settings };

function vocab(id: string, createdAt: string): VocabEntry {
  return { id, word: id, context: 'a sentence', bookId: 'b', bookTitle: 'B', chapterId: 'c', chapterTitle: 'C', paragraphIndex: 0, note: '', createdAt, familiarity: 0, dueAt: createdAt, reviewCount: 0 };
}

const NOW = Date.parse('2026-11-15T12:00:00Z');
const recent = new Date(NOW - 2000).toISOString(); // 2 秒前
const old = new Date(NOW - 3600_000).toISOString(); // 1 小时前

test('mergeSnapshots：本地刚收藏、对方快照没有的词被并回（不丢）', () => {
  const local: AppData = { ...base, vocabulary: [vocab('vehemently', recent)] };
  const incoming: AppData = { ...base, rev: 5, vocabulary: [] };
  const { data, preserved } = mergeSnapshots(local, incoming, NOW);
  assert.equal(preserved, 1);
  assert.deepEqual(data.vocabulary.map((e) => e.id), ['vehemently']);
});

test('mergeSnapshots：核心修复——一小时前的本地词（无墓碑）也不再被旧快照抹掉', () => {
  // 早期只保护 10 秒内新增，后台标签页隔几分钟写盘就会丢词；并集合并与创建时间无关。
  const local: AppData = { ...base, vocabulary: [vocab('embarrassment', old)] };
  const incoming: AppData = { ...base, rev: 5, vocabulary: [] };
  const { data, preserved } = mergeSnapshots(local, incoming, NOW);
  assert.equal(preserved, 1);
  assert.deepEqual(data.vocabulary.map((e) => e.id), ['embarrassment']);
});

test('mergeSnapshots：本地立了墓碑的词被剔除（删除能传播）', () => {
  const local: AppData = { ...base, vocabulary: [vocab('deleted', old)], tombstones: { deleted: NOW - 1000 } };
  const incoming: AppData = { ...base, rev: 5, vocabulary: [vocab('deleted', old)] };
  const { data } = mergeSnapshots(local, incoming, NOW);
  assert.deepEqual(data.vocabulary, []);
  assert.equal(data.tombstones?.deleted, NOW - 1000);
});

test('mergeSnapshots：对方墓碑剔除本地仍持有的词（跨标签页删除）', () => {
  const local: AppData = { ...base, vocabulary: [vocab('gone', old)] };
  const incoming: AppData = { ...base, rev: 5, vocabulary: [], tombstones: { gone: NOW - 500 } };
  const { data } = mergeSnapshots(local, incoming, NOW);
  assert.deepEqual(data.vocabulary, []);
});

test('mergeSnapshots：撤销复活——createdAt 晚于墓碑的记录保留', () => {
  const local: AppData = { ...base, vocabulary: [vocab('revived', recent)], tombstones: { revived: NOW - 5000 } };
  const incoming: AppData = { ...base, rev: 5, vocabulary: [], tombstones: { revived: NOW - 5000 } };
  const { data } = mergeSnapshots(local, incoming, NOW);
  assert.deepEqual(data.vocabulary.map((e) => e.id), ['revived']);
});

test('mergeSnapshots：双方都有的词不重复，以对方（更新 rev）版本为准', () => {
  const local: AppData = { ...base, vocabulary: [{ ...vocab('shared', recent), familiarity: 0 }] };
  const incoming: AppData = { ...base, rev: 5, vocabulary: [{ ...vocab('shared', recent), familiarity: 3 }] };
  const { data, preserved } = mergeSnapshots(local, incoming, NOW);
  assert.equal(preserved, 0);
  assert.equal(data.vocabulary.length, 1);
  assert.equal(data.vocabulary[0].familiarity, 3);
});

test('mergeSnapshots：句子/标记/播放列表/书的本地独有记录都被保护', () => {
  const local: AppData = {
    ...base,
    sentences: [{ id: 's1', createdAt: old } as SavedSentence],
    highlights: [{ id: 'h1', createdAt: old } as Highlight],
    playlists: [{ id: 'p1', name: 'P', bookIds: [], createdAt: old }],
    books: [{ id: 'book1', createdAt: old } as unknown as AppData['books'][number]],
  };
  const incoming: AppData = { ...base, rev: 5 };
  const { data, preserved } = mergeSnapshots(local, incoming, NOW);
  assert.equal(preserved, 4);
  assert.equal(data.sentences?.length, 1);
  assert.equal(data.highlights.length, 1);
  assert.equal(data.playlists?.length, 1);
  assert.equal(data.books.length, 1);
});

test('mergeSnapshots：墓碑取双方较新时刻，并剪掉超过 30 天的过期墓碑', () => {
  const ancient = NOW - 40 * 24 * 3600_000;
  const local: AppData = { ...base, tombstones: { a: NOW - 2000, stale: ancient } };
  const incoming: AppData = { ...base, rev: 5, tombstones: { a: NOW - 8000, b: NOW - 1000 } };
  const { data } = mergeSnapshots(local, incoming, NOW);
  assert.equal(data.tombstones?.a, NOW - 2000); // 取较新
  assert.equal(data.tombstones?.b, NOW - 1000);
  assert.equal(data.tombstones?.stale, undefined); // 过期剪掉
});
