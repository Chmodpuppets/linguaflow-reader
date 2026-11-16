import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPracticeTargets } from '../../src/lib/practiceTargets';
import type { Book, Highlight, SavedSentence } from '../../src/types';

function mkBook(id: string, title: string, paragraphs: string[]): Book {
  return {
    id, title, author: 'A', description: '', cover: '', accent: '#8b5cf6',
    chapters: [{ id: `${id}-c1`, title: 'Chapter 1', paragraphs }],
    progress: 0, currentChapter: 0, currentParagraph: 0,
    addedAt: '2026-01-01T00:00:00.000Z', source: 'text',
  };
}
function mkSentence(id: string, text: string, bookId: string, bookTitle: string): SavedSentence {
  return { id, text, word: 'w', meaning: '', phonetic: '', bookId, bookTitle, chapterId: `${bookId}-c1`, chapterTitle: 'Chapter 1', paragraphIndex: 0, createdAt: '2026-01-01T00:00:00.000Z' };
}
function mkHighlight(id: string, text: string, bookId: string): Highlight {
  return { id, bookId, chapterId: `${bookId}-c1`, paragraphIndex: 0, text, note: '', color: 'violet', createdAt: '2026-01-01T00:00:00.000Z' };
}

const long = 'This is a sufficiently long paragraph about the quiet forest and the curious fox wandering slowly.';
const book = mkBook('b1', 'The Fox', [long, 'short', long]);

test('freetalk 模式返回空列表', () => {
  assert.deepEqual(buildPracticeTargets([book], [mkHighlight('h', long, 'b1')], [mkSentence('s', 'A saved sentence here.', 'b1', 'The Fox')], 'freetalk'), []);
});

test('收藏句最优先且分组正确', () => {
  const targets = buildPracticeTargets([book], [], [mkSentence('s1', 'A saved sentence here.', 'b1', 'The Fox')], 'shadowing');
  assert.equal(targets[0].group, 'sentence');
  assert.equal(targets[0].id, 'sentence-s1');
  assert.equal(targets[0].source, 'The Fox');
  assert.equal(targets[0].text, 'A saved sentence here.');
});

test('顺序：收藏句 → 标记 → 书中段落', () => {
  const targets = buildPracticeTargets([book], [mkHighlight('h1', 'a highlighted phrase', 'b1')], [mkSentence('s1', 'A saved sentence here.', 'b1', 'The Fox')], 'shadowing');
  assert.deepEqual(targets.map((t) => t.group), ['sentence', 'highlight', 'paragraph']);
  assert.equal(targets[1].noteId, 'h1');
});

test('按文本去重，收藏句优先于同文段落', () => {
  const targets = buildPracticeTargets([book], [], [mkSentence('s1', long, 'b1', 'The Fox')], 'shadowing');
  // long 在书里出现两次 + 收藏句一次 → 去重后只剩收藏句那一条
  assert.equal(targets.filter((t) => t.text === long).length, 1);
  assert.equal(targets[0].group, 'sentence');
});

test('书中段落长度过滤（太短/太长排除）', () => {
  const tooLong = 'x'.repeat(700);
  const b = mkBook('b2', 'B', ['tiny', tooLong, long]);
  const targets = buildPracticeTargets([b], [], [], 'shadowing');
  assert.equal(targets.length, 1);
  assert.equal(targets[0].text, long);
  assert.equal(targets[0].group, 'paragraph');
});

test('书中段落候选限量 60，且排在用户内容之后', () => {
  const many = mkBook('m', 'Many', Array.from({ length: 100 }, (_, i) => `Distinct paragraph number ${i} with enough words to pass the length filter easily.`));
  const targets = buildPracticeTargets([many], [], [mkSentence('s', 'My own saved sentence.', 'm', 'Many')], 'shadowing');
  assert.equal(targets[0].group, 'sentence');
  assert.equal(targets.filter((t) => t.group === 'paragraph').length, 60);
});

test('全空返回空列表', () => {
  assert.deepEqual(buildPracticeTargets([], [], [], 'shadowing'), []);
});
