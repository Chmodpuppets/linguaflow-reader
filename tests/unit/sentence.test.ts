import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeRegExp, splitSentences, extractSentence, sentenceParts, sentenceToReviewEntry } from '../../src/lib/sentence';

test('splitSentences：按句末标点切分并保留收尾引号', () => {
  const paragraph = 'He said, “Just remember.” Then he left! What next?';
  assert.deepEqual(splitSentences(paragraph), ['He said, “Just remember.”', 'Then he left!', 'What next?']);
});

test('splitSentences：无句末标点时整段作为一句', () => {
  assert.deepEqual(splitSentences('a single line without punctuation'), ['a single line without punctuation']);
});

test('extractSentence：整词边界优先，chapter 不误选 chapters 句', () => {
  const paragraph = 'The chapters are long. This chapter is short. Another line here.';
  assert.equal(extractSentence(paragraph, 'chapter'), 'This chapter is short.');
});

test('extractSentence：无整词命中时退包含匹配', () => {
  const paragraph = 'First sentence here. The chapters are long.';
  assert.equal(extractSentence(paragraph, 'chapter'), 'The chapters are long.');
});

test('extractSentence：完全无命中回退第一句', () => {
  const paragraph = 'Alpha one. Beta two.';
  assert.equal(extractSentence(paragraph, 'zzz'), 'Alpha one.');
});

test('extractSentence：空词回退第一句', () => {
  assert.equal(extractSentence('Alpha one. Beta two.', '  '), 'Alpha one.');
});

test('sentenceParts：高亮目标词（不区分大小写、整词边界）', () => {
  const parts = sentenceParts('This Chapter is short.', 'chapter');
  assert.deepEqual(parts, [
    { text: 'This ', hit: false },
    { text: 'Chapter', hit: true },
    { text: ' is short.', hit: false },
  ]);
});

test('sentenceParts：chapters 不被 chapter 高亮', () => {
  const parts = sentenceParts('The chapters are long.', 'chapter');
  assert.deepEqual(parts, [{ text: 'The chapters are long.', hit: false }]);
});

test('sentenceParts：多次命中都高亮', () => {
  const parts = sentenceParts('cat and cat.', 'cat');
  const hits = parts.filter((p) => p.hit).map((p) => p.text);
  assert.deepEqual(hits, ['cat', 'cat']);
});

test('escapeRegExp：转义特殊字符', () => {
  assert.equal(escapeRegExp('a.b*c'), 'a\\.b\\*c');
});

test('sentenceToReviewEntry：映射为合成词条供挖空复习', () => {
  const entry = sentenceToReviewEntry({ id: 's1', text: 'The spotlight of the mind wanders.', word: 'spotlight', meaning: '聚光灯', phonetic: 'ˈspɒtlaɪt', bookId: 'b', bookTitle: 'B', chapterId: 'c', chapterTitle: 'C', paragraphIndex: 1, createdAt: '2026-01-01T00:00:00Z' });
  assert.equal(entry.id, 's1');
  assert.equal(entry.word, 'spotlight');
  assert.equal(entry.context, 'The spotlight of the mind wanders.');
  assert.equal(entry.dictionary?.chinese, '聚光灯');
  assert.equal(entry.dictionary?.phonetic, 'ˈspɒtlaɪt');
});
