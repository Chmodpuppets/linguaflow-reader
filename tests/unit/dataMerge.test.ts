import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRecentAdds } from '../../src/lib/dataMerge';
import type { AppData, Highlight, SavedSentence, VocabEntry } from '../../src/types';

const settings = { fontSize: 18, lineHeight: 1.8, theme: 'midnight', reducedAmbient: false } as AppData['settings'];
const base: AppData = { books: [], vocabulary: [], highlights: [], reviewLogs: [], voiceRecords: [], settings };

function vocab(id: string, createdAt: string): VocabEntry {
  return { id, word: id, context: 'a sentence', bookId: 'b', bookTitle: 'B', chapterId: 'c', chapterTitle: 'C', paragraphIndex: 0, note: '', createdAt, familiarity: 0, dueAt: createdAt, reviewCount: 0 };
}

const NOW = Date.parse('2026-11-15T12:00:00Z');
const recent = new Date(NOW - 2000).toISOString(); // 2 秒前
const old = new Date(NOW - 3600_000).toISOString(); // 1 小时前

test('mergeRecentAdds：本地刚收藏、对方快照没有的词被并回（不丢）', () => {
  const local: AppData = { ...base, vocabulary: [vocab('vehemently', recent)] };
  const incoming: AppData = { ...base, rev: 5, vocabulary: [] };
  const { data, preserved } = mergeRecentAdds(local, incoming, NOW);
  assert.equal(preserved, 1);
  assert.deepEqual(data.vocabulary.map((e) => e.id), ['vehemently']);
});

test('mergeRecentAdds：较早的本地记录以对方快照为准（删除能传播）', () => {
  const local: AppData = { ...base, vocabulary: [vocab('deleted', old)] };
  const incoming: AppData = { ...base, rev: 5, vocabulary: [] };
  const { data, preserved } = mergeRecentAdds(local, incoming, NOW);
  assert.equal(preserved, 0);
  assert.deepEqual(data.vocabulary, []);
});

test('mergeRecentAdds：双方都有的词不重复，以对方（更新 rev）版本为准', () => {
  const local: AppData = { ...base, vocabulary: [{ ...vocab('shared', recent), familiarity: 0 }] };
  const incoming: AppData = { ...base, rev: 5, vocabulary: [{ ...vocab('shared', recent), familiarity: 3 }] };
  const { data, preserved } = mergeRecentAdds(local, incoming, NOW);
  assert.equal(preserved, 0);
  assert.equal(data.vocabulary.length, 1);
  assert.equal(data.vocabulary[0].familiarity, 3);
});

test('mergeRecentAdds：刚收藏的句子/标记同样被保护', () => {
  const local: AppData = {
    ...base,
    sentences: [{ id: 's1', createdAt: recent } as SavedSentence],
    highlights: [{ id: 'h1', createdAt: recent } as Highlight],
  };
  const incoming: AppData = { ...base, rev: 5 };
  const { data, preserved } = mergeRecentAdds(local, incoming, NOW);
  assert.equal(preserved, 2);
  assert.equal(data.sentences?.length, 1);
  assert.equal(data.highlights.length, 1);
});

test('mergeRecentAdds：无本地新增时原样采纳对方快照', () => {
  const local: AppData = { ...base, vocabulary: [vocab('a', old)] };
  const incoming: AppData = { ...base, rev: 9, vocabulary: [vocab('b', recent)] };
  const { data, preserved } = mergeRecentAdds(local, incoming, NOW);
  assert.equal(preserved, 0);
  assert.equal(data.rev, 9);
  assert.deepEqual(data.vocabulary.map((e) => e.id), ['b']);
});
