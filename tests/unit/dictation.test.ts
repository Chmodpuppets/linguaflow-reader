import test from 'node:test';
import assert from 'node:assert/strict';
import { dictationCorrect, normalizeDictation } from '../../src/lib/dictation';

test('normalizeDictation 大小写/空白/末尾标点/弯撇号', () => {
  assert.equal(normalizeDictation('  Garden. '), 'garden');
  assert.equal(normalizeDictation('DON’T'), "don't");
  assert.equal(normalizeDictation('well - known'), 'well - known');
});

test('dictationCorrect 判定', () => {
  assert.equal(dictationCorrect('garden', 'Garden'), true);
  assert.equal(dictationCorrect('garden', 'garden!'), true);
  assert.equal(dictationCorrect('garden', 'gardens'), false);
  assert.equal(dictationCorrect('garden', ''), false);
  assert.equal(dictationCorrect("don't", 'dont'), false);
});
