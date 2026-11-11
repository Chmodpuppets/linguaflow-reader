import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignSegmentsToLines, collectBookLines } from '../../src/lib/bookAlignment';
import type { Book } from '../../src/types';
import type { TimedChunk } from '../../src/lib/whisperTypes';

test('collectBookLines：保留有实词的行，滤掉插画页 / 页码 / 气泡短词', () => {
  const book = { chapters: [{ id: 'c', title: 't', paragraphs: [
    'This is a sufficiently long line with enough words.',
    'Hi',
    '12',
    'Another proper sentence that has several real words in it.',
  ] }] } as unknown as Book;
  assert.equal(collectBookLines(book).length, 2);
});

test('alignSegmentsToLines：行或片段太少返回空', () => {
  assert.deepEqual(alignSegmentsToLines(['a b c d e f'], [{ start: 0, end: 1, text: 'a b c' }]), []);
});

test('alignSegmentsToLines：锚点时间单调、首尾对齐', () => {
  const lines = [
    'the quick brown fox jumps over',
    'lazy dog sleeps in the sun',
    'birds sing early in the morning',
    'children play outside all day long',
  ];
  const chunks: TimedChunk[] = [
    { start: 0, end: 2, text: 'the quick brown fox jumps over' },
    { start: 2, end: 4, text: 'lazy dog sleeps in the sun' },
    { start: 4, end: 6, text: 'birds sing early in the morning' },
    { start: 6, end: 8, text: 'children play outside all day long' },
  ];
  const aligned = alignSegmentsToLines(lines, chunks);
  assert.equal(aligned.length, 4);
  for (let i = 1; i < aligned.length; i += 1) assert.ok(aligned[i].s >= aligned[i - 1].s, '起点时间单调不减');
  assert.equal(aligned[0].s, 0);
  assert.equal(aligned[3].e, 8);
});

test('alignSegmentsToLines：重复文本只保留首次', () => {
  const lines = ['same repeated line here now', 'same repeated line here now', 'a different line altogether friend'];
  const chunks: TimedChunk[] = [
    { start: 0, end: 2, text: 'same repeated line here now' },
    { start: 2, end: 4, text: 'same repeated line here now' },
    { start: 4, end: 6, text: 'a different line altogether friend' },
  ];
  const texts = alignSegmentsToLines(lines, chunks).map((a) => a.t);
  assert.equal(new Set(texts).size, texts.length);
});
