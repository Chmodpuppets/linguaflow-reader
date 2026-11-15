import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfPagesToChapters } from '../../src/lib/pdfChapters';

test('pdfPagesToChapters：按章节标题切分', () => {
  const pages = [
    'Chapter 1: The Beginning\n\nIt was a bright cold day in April, and the clocks were striking thirteen.\n\nWinston Smith kept his head down.',
    'Chapter 2: The Road\n\nThe road wound on through the hills.\n\n42',
  ];
  const chapters = pdfPagesToChapters(pages);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].title, 'Chapter 1: The Beginning');
  assert.ok(chapters[0].paragraphs[0].includes('bright cold day'));
  assert.equal(chapters[1].title, 'Chapter 2: The Road');
  // 纯数字页码被过滤
  assert.ok(chapters[1].paragraphs.every((p) => !/^\d+$/.test(p)));
});

test('pdfPagesToChapters：硬换行的一整段还原为自然段', () => {
  const pages = ['Chapter One\n\nThe quick brown fox\njumps over the lazy dog\nnear the river bank.'];
  const chapters = pdfPagesToChapters(pages);
  assert.equal(chapters[0].paragraphs[0], 'The quick brown fox jumps over the lazy dog near the river bank.');
});

test('pdfPagesToChapters：无标题时按页分组成 Part', () => {
  const pages = Array.from({ length: 25 }, (_, i) => `Page ${i} has some prose about the world and its quiet rivers.`);
  const chapters = pdfPagesToChapters(pages);
  assert.ok(chapters.length >= 2);
  assert.ok(chapters[0].title.startsWith('Part'));
  assert.ok(chapters.every((c) => c.paragraphs.length > 0));
});

test('pdfPagesToChapters：中文「第X章」标题识别', () => {
  const pages = ['第一章 起点\n\n他推开门，走了进去。\n\n第二章 远方\n\n路在脚下延伸。'];
  const chapters = pdfPagesToChapters(pages);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].title, '第一章 起点');
});

test('pdfPagesToChapters：空输入返回空', () => {
  assert.deepEqual(pdfPagesToChapters([]), []);
  assert.deepEqual(pdfPagesToChapters(['', '   ']), []);
});
