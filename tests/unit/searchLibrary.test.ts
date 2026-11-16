import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnippet, searchLibrary } from '../../src/lib/searchLibrary';
import type { Book } from '../../src/types';

function mkBook(id: string, title: string, chapters: { id: string; title: string; paragraphs: string[] }[]): Book {
  return {
    id, title, author: 'A', description: '', cover: '', accent: '#8b5cf6',
    chapters, progress: 0, currentChapter: 0, currentParagraph: 0,
    addedAt: '2026-01-01T00:00:00.000Z', source: 'text',
  };
}

const fox = mkBook('b1', 'The Fox', [
  { id: 'c1', title: 'Chapter 1', paragraphs: ['A curious fox wanders through the quiet forest.', 'The fox sleeps under a tall oak tree.'] },
  { id: 'c2', title: 'Chapter 2', paragraphs: ['Winter comes. The fox hunts in the snow.'] },
]);
const cat = mkBook('b2', 'The Cat', [
  { id: 'c1', title: 'Chapter 1', paragraphs: ['A curious cat sits on the warm mat.', 'No match here at all.'] },
]);

test('空查询返回空数组', () => {
  assert.deepEqual(searchLibrary([fox, cat], ''), []);
  assert.deepEqual(searchLibrary([fox, cat], '   '), []);
});

test('大小写不敏感跨书查找，命中字段与语境正确', () => {
  const hits = searchLibrary([fox, cat], 'CURIOUS');
  assert.equal(hits.length, 2);
  assert.equal(hits[0].bookId, 'b1');
  assert.equal(hits[0].chapterId, 'c1');
  assert.equal(hits[0].paragraphIndex, 0);
  assert.equal(hits[0].snippet.match, 'curious');
  assert.equal(hits[1].bookId, 'b2');
});

test('多词短语整体匹配', () => {
  const hits = searchLibrary([fox], 'quiet forest');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].snippet.match, 'quiet forest');
});

test('每段只取首个命中', () => {
  const hits = searchLibrary([fox], 'fox');
  // c1 两段各一命中 + c2 一段一命中 = 3（而非按出现次数）
  assert.equal(hits.length, 3);
});

test('无匹配返回空', () => {
  assert.deepEqual(searchLibrary([fox, cat], 'zebra'), []);
});

test('maxPerBook 限制单书命中数，limit 限制总数', () => {
  const many = mkBook('m', 'Many', [{ id: 'c', title: 'C', paragraphs: Array.from({ length: 30 }, (_, i) => `word number ${i} here`) }]);
  assert.equal(searchLibrary([many], 'word', { maxPerBook: 5 }).length, 5);
  assert.equal(searchLibrary([many, many], 'word', { maxPerBook: 50, limit: 7 }).length, 7);
});

test('buildSnippet 边界不补省略号，中段两侧补省略号', () => {
  const short = buildSnippet('a curious fox', 2, 7);
  assert.equal(short.before, 'a ');
  assert.equal(short.match, 'curious');
  assert.equal(short.after, ' fox');
  const long = 'x'.repeat(100) + 'needle' + 'y'.repeat(100);
  const mid = buildSnippet(long, 100, 6);
  assert.ok(mid.before.startsWith('…'));
  assert.ok(mid.after.endsWith('…'));
  assert.equal(mid.match, 'needle');
});
