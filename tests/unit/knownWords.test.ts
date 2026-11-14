import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeKnownWords } from '../../src/lib/knownWords';
import type { ReviewLog, VocabEntry } from '../../src/types';

const vocab = (id: string, word: string, familiarity: number) => ({ id, word, familiarity } as VocabEntry);
const log = (vocabId: string, result: ReviewLog['result']) => ({ vocabId, result } as ReviewLog);

test('computeKnownWords：熟悉度≥3 纳入，<3 且无 good 复习不纳入', () => {
  const out = computeKnownWords([vocab('a', 'Apple', 3), vocab('b', 'banana', 2)], [], {}, []);
  assert.deepEqual(out, ['apple']);
});

test('computeKnownWords：good/easy 复习让低熟悉度词也算已知', () => {
  const out = computeKnownWords([vocab('b', 'banana', 0)], [log('b', 'good')], {}, []);
  assert.deepEqual(out, ['banana']);
});

test('computeKnownWords：阅读标「已掌握」驱动难度，「学习中」不算', () => {
  const out = computeKnownWords([], [], { Cherry: 'known', date: 'learning' }, []);
  assert.deepEqual(out, ['cherry']);
});

test('computeKnownWords：云端合并 + 小写去重', () => {
  const out = computeKnownWords([vocab('a', 'apple', 3)], [], { APPLE: 'known' }, ['Apple', 'elderberry']);
  assert.deepEqual(out.sort(), ['apple', 'elderberry']);
});

test('computeKnownWords：全空返回空（离线无积累时不显示难度）', () => {
  assert.deepEqual(computeKnownWords([], [], {}, []), []);
});
