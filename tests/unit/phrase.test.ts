import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPhrase, isMultiWord, normalizeForCompare, phraseKey, wordCount } from '../../src/lib/phrase';
import { computeKnownWords } from '../../src/lib/knownWords';
import type { VocabEntry } from '../../src/types';

test('cleanPhrase 折叠空白并修剪', () => {
  assert.equal(cleanPhrase('  give   up \n now '), 'give up now');
  assert.equal(cleanPhrase('   '), '');
});

test('wordCount / isMultiWord 判定多词短语', () => {
  assert.equal(wordCount('give up'), 2);
  assert.equal(wordCount('  a  b  c '), 3);
  assert.equal(wordCount('word'), 1);
  assert.equal(wordCount(''), 0);
  assert.equal(isMultiWord('give up'), true);
  assert.equal(isMultiWord('hello'), false);
});

test('phraseKey 小写归一去重', () => {
  assert.equal(phraseKey('Give UP'), 'give up');
  assert.equal(phraseKey('give  up'), phraseKey('GIVE UP'));
});

test('normalizeForCompare 让短语挖空判定宽容', () => {
  assert.equal(normalizeForCompare('Give Up!'), normalizeForCompare('give up'));
  assert.equal(normalizeForCompare('  give   up '), 'giveup');
  assert.notEqual(normalizeForCompare('give in'), normalizeForCompare('give up'));
});

test('computeKnownWords 不把短语计入单个已知词', () => {
  const phrase = { id: 'p', word: 'give up', isPhrase: true, familiarity: 4 } as VocabEntry;
  const word = { id: 'w', word: 'apple', familiarity: 4 } as VocabEntry;
  const out = computeKnownWords([phrase, word], [], {}, []);
  assert.deepEqual(out, ['apple']);
});
