import { test } from 'node:test';
import assert from 'node:assert/strict';
import { complexityOf, complexitySuggestion } from '../../src/lib/complexity';

test('complexityOf：简单短句', () => {
  const c = complexityOf('I like cats. I like dogs.');
  assert.equal(c.wordCount, 6);
  assert.equal(c.sentenceCount, 2);
  assert.equal(c.avgSentenceLen, 3);
  assert.equal(c.clauseCount, 0);
  assert.equal(c.level, 'simple');
});

test('complexityOf：发展中（有从句/句长达标）', () => {
  const c = complexityOf('I went to the park because it was sunny.');
  assert.equal(c.clauseCount, 1);
  assert.equal(c.level, 'developing');
});

test('complexityOf：丰富（长句+多从句）', () => {
  const c = complexityOf('Although it was raining, we went out because we wanted to see the game.');
  assert.equal(c.clauseCount, 2);
  assert.ok(c.avgSentenceLen >= 12);
  assert.equal(c.level, 'rich');
});

test('complexityOf：TTR 词汇多样性', () => {
  const c = complexityOf('a a a b');
  assert.equal(c.wordCount, 4);
  assert.equal(c.ttr, 0.5);
});

test('complexityOf：空文本与提示', () => {
  const c = complexityOf('');
  assert.equal(c.wordCount, 0);
  assert.equal(c.level, 'simple');
  assert.match(complexitySuggestion(c), /先开口/);
});

test('complexitySuggestion：按层级给下一步', () => {
  assert.match(complexitySuggestion(complexityOf('I like cats.')), /because/);
  assert.match(complexitySuggestion(complexityOf('Although it was raining, we went out because we wanted to see the game.')), /准确/);
});
