import test from 'node:test';
import assert from 'node:assert/strict';
import { chunksToAlignedLines, chunksToChapters, groupChunksToParagraphs } from '../../src/lib/lessonBuilder';
import type { TimedChunk } from '../../src/lib/whisperTypes';

const chunk = (text: string, start: number, end: number): TimedChunk => ({ text, start, end });

test('groupChunksToParagraphs：按 perGroup 句合并成段，折叠空白', () => {
  const chunks = [chunk('Hello there.', 0, 1), chunk('  How are you? ', 1, 2), chunk('I am fine.', 2, 3), chunk('And you?', 3, 4)];
  assert.deepEqual(groupChunksToParagraphs(chunks, 3), ['Hello there. How are you? I am fine.', 'And you?']);
  assert.deepEqual(groupChunksToParagraphs([], 3), []);
  // 空句被过滤
  assert.deepEqual(groupChunksToParagraphs([chunk('  ', 0, 1), chunk('Real text.', 1, 2)], 3), ['Real text.']);
});

test('chunksToChapters：短音频单章「课文」，长音频按 12 段分 Part', () => {
  const short = [chunk('One sentence here.', 0, 1), chunk('Another sentence here.', 1, 2)];
  const shortChapters = chunksToChapters('b', short);
  assert.equal(shortChapters.length, 1);
  assert.equal(shortChapters[0].title, '课文');
  assert.equal(shortChapters[0].id, 'b-ch-0');

  // 40 句 → 每 3 句一段 ≈ 14 段 → 2 章（12 + 2）
  const long = Array.from({ length: 40 }, (_, i) => chunk(`Sentence number ${i} with words.`, i, i + 1));
  const longChapters = chunksToChapters('b', long);
  assert.equal(longChapters.length, 2);
  assert.equal(longChapters[0].title, 'Part 1');
  assert.equal(longChapters[1].title, 'Part 2');
  assert.equal(longChapters[0].paragraphs.length, 12);
  assert.deepEqual(chunksToChapters('b', []), []);
});

test('chunksToAlignedLines：去重 / 修剪 / 最短 0.25s / 起点不为负', () => {
  const lines = chunksToAlignedLines([
    chunk('  The quick brown fox. ', 1, 3),
    chunk('the quick brown fox.', 5, 7), // 重复（大小写不敏感）→ 丢弃
    chunk('Jumps over.', 8, 8.1), // 时长不足 → 补到 0.25
    chunk('', 9, 10), // 空 → 丢弃
  ]);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], { t: 'The quick brown fox.', s: 1, e: 3 });
  assert.equal(lines[1].t, 'Jumps over.');
  assert.ok(lines[1].e - lines[1].s >= 0.25);
});
