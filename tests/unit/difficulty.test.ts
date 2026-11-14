import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookWordFreq, coveragePercent, difficultyBand, bookDifficulty, STOPWORDS } from '../../src/lib/difficulty';

test('bookWordFreq 统计内容词词频，排除功能词/纯数字/单字符', () => {
  const chapters = [{ paragraphs: ['The cat sat. The cat ran!', 'A 123 x cat.'] }];
  const freq = bookWordFreq(chapters);
  assert.equal(freq.get('cat'), 3);
  assert.equal(freq.get('sat'), 1);
  assert.equal(freq.get('ran'), 1);
  assert.equal(freq.has('the'), false);
  assert.equal(freq.has('a'), false);
  assert.equal(freq.has('123'), false);
  assert.equal(freq.has('x'), false);
  assert.ok(STOPWORDS.has('the'));
});

test('coveragePercent 词频加权：已知词占词次比例', () => {
  const freq = new Map([['alpha', 3], ['beta', 1]]);
  assert.equal(coveragePercent(freq, new Set(['alpha'])), 75);
  assert.equal(coveragePercent(freq, new Set(['alpha', 'beta'])), 100);
  assert.equal(coveragePercent(freq, new Set()), 0);
  assert.equal(coveragePercent(new Map(), new Set(['alpha'])), 0);
});

test('difficultyBand 分档边界：90–98 为 i+1 理想区间', () => {
  assert.equal(difficultyBand(100).key, 'easy');
  assert.equal(difficultyBand(98).key, 'easy');
  assert.equal(difficultyBand(97).key, 'ideal');
  assert.equal(difficultyBand(90).key, 'ideal');
  assert.equal(difficultyBand(90).ideal, true);
  assert.equal(difficultyBand(89).key, 'stretch');
  assert.equal(difficultyBand(75).key, 'stretch');
  assert.equal(difficultyBand(74).key, 'hard');
  assert.equal(difficultyBand(0).key, 'hard');
});

test('bookDifficulty 已知词为空返回 null；否则给覆盖率+分档', () => {
  const book = { id: 'b1', chapters: [{ id: 'c1', title: 'Ch1', paragraphs: ['Curiosity thrives. Curiosity grows.'] }] };
  assert.equal(bookDifficulty(book, new Set()), null);
  const diff = bookDifficulty(book, new Set(['curiosity']));
  assert.ok(diff);
  // curiosity x2 / (curiosity2 + thrives1 + grows1) = 2/4 = 50
  assert.equal(diff.coverage, 50);
  assert.equal(diff.band.key, 'hard');
  const all = bookDifficulty(book, new Set(['curiosity', 'thrives', 'grows']));
  assert.ok(all);
  assert.equal(all.coverage, 100);
  assert.equal(all.band.key, 'easy');
});
