import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBookFromText } from '../../src/lib/textBook';
import { computeStreak, todayActions, wordStateCounts, dayKey } from '../../src/lib/streak';
import type { AppData } from '../../src/types';

test('buildBookFromText：空行分段、单换行合并、source=text', () => {
  const book = buildBookFromText('My Article', '', 'Hello world\nthis is one paragraph.\n\nSecond paragraph here.', 'b1');
  assert.equal(book.source, 'text');
  assert.equal(book.chapters.length, 1);
  assert.deepEqual(book.chapters[0].paragraphs, ['Hello world this is one paragraph.', 'Second paragraph here.']);
});

test('buildBookFromText：Markdown 标题分章', () => {
  const book = buildBookFromText('', '', '# Chapter One\n\nAlpha beta.\n\n## Chapter Two\n\nGamma delta.', 'b2');
  assert.equal(book.chapters.length, 2);
  assert.equal(book.chapters[0].title, 'Chapter One');
  assert.equal(book.chapters[1].title, 'Chapter Two');
  assert.deepEqual(book.chapters[1].paragraphs, ['Gamma delta.']);
});

test('buildBookFromText：无标题长文自动切块', () => {
  const para = 'Some meaningful english sentence here.';
  const text = Array.from({ length: 30 }, () => para).join('\n\n');
  const book = buildBookFromText('Long', '', text, 'b3');
  assert.ok(book.chapters.length >= 2);
});

test('buildBookFromText：空文本抛错', () => {
  assert.throws(() => buildBookFromText('t', '', '   ', 'b4'));
});

const base = (): AppData => ({ books: [], vocabulary: [], highlights: [], reviewLogs: [], voiceRecords: [], sentences: [], wordStates: {}, glosses: {}, settings: { fontSize: 19, lineHeight: 1.8, theme: 'midnight', reducedAmbient: true } });
const iso = (d: Date) => d.toISOString();

test('computeStreak：连续天数（含今天）', () => {
  const now = new Date('2026-11-13T12:00:00');
  const data = base();
  const day = (offset: number) => { const d = new Date(now); d.setDate(d.getDate() - offset); return iso(d); };
  data.reviewLogs = [0, 1, 2].map((i) => ({ id: `r${i}`, vocabId: 'v', result: 'good', mode: 'flashcard', createdAt: day(i) }));
  assert.equal(computeStreak(data, now), 3);
});

test('computeStreak：今天没学不打断昨天 streak', () => {
  const now = new Date('2026-11-13T12:00:00');
  const data = base();
  const day = (offset: number) => { const d = new Date(now); d.setDate(d.getDate() - offset); return iso(d); };
  data.reviewLogs = [1, 2].map((i) => ({ id: `r${i}`, vocabId: 'v', result: 'good', mode: 'flashcard', createdAt: day(i) }));
  assert.equal(computeStreak(data, now), 2);
});

test('todayActions 与 wordStateCounts', () => {
  const now = new Date('2026-11-13T12:00:00');
  const data = base();
  data.reviewLogs = [{ id: 'r', vocabId: 'v', result: 'good', mode: 'flashcard', createdAt: iso(now) }];
  data.wordStates = { a: 'known', b: 'known', c: 'learning' };
  assert.equal(todayActions(data, now), 1);
  assert.deepEqual(wordStateCounts(data), { known: 2, learning: 1 });
  assert.equal(dayKey(now), '2026-11-13');
});
