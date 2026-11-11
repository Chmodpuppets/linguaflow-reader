import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerAlignment, clearAlignment, findAudioSpan, hasAlignment } from '../../src/lib/audioAlign';

test('findAudioSpan：按词重叠命中已注册的行', () => {
  registerAlignment('book-a', [{ t: 'the quick brown fox jumps', s: 1, e: 3 }]);
  assert.deepEqual(findAudioSpan('book-a', 'the quick brown fox jumps'), { start: 1, end: 3 });
});

test('findAudioSpan：没有对齐的书返回 null', () => {
  assert.equal(findAudioSpan('no-such-book', 'the quick brown fox'), null);
});

test('findAudioSpan：重叠率过低返回 null', () => {
  registerAlignment('book-b', [{ t: 'completely different words here', s: 0, e: 2 }]);
  assert.equal(findAudioSpan('book-b', 'the quick brown fox'), null);
});

test('findAudioSpan：不同书的时间轴互相隔离', () => {
  registerAlignment('book-c', [{ t: 'alpha beta gamma delta', s: 5, e: 7 }]);
  assert.equal(findAudioSpan('book-d', 'alpha beta gamma delta'), null);
});

test('clearAlignment：清除后不再命中', () => {
  registerAlignment('book-e', [{ t: 'one two three four five', s: 0, e: 1 }]);
  assert.ok(hasAlignment('book-e'));
  clearAlignment('book-e');
  assert.equal(findAudioSpan('book-e', 'one two three four five'), null);
});
