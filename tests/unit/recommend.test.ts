import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommendBook, coldStartPick } from '../../src/lib/difficulty';
import type { Book } from '../../src/types';

const mk = (id: string, words: string[], progress = 0): Book => ({
  id, title: id, author: '', description: '', cover: '', accent: '#000',
  progress, currentChapter: 0, currentParagraph: 0, addedAt: '', source: 'sample',
  chapters: [{ id: `${id}-1`, title: id, paragraphs: [words.join(' ')] }],
});
const rep = (w: string, n: number) => Array.from({ length: n }, () => w);

test('recommendBook：已知词为空返回 null', () => {
  assert.equal(recommendBook([mk('a', rep('apple', 20))], new Set()), null);
});

test('recommendBook：理想区间优先于轻松/挑战', () => {
  const known = new Set(['apple']);
  const easy = mk('easy', rep('apple', 20));        // 100%
  const ideal = mk('ideal', [...rep('apple', 19), 'zebra']); // 95%
  const hard = mk('hard', rep('zebra', 20));        // 0%
  const rec = recommendBook([easy, hard, ideal], known);
  assert.ok(rec);
  assert.equal(rec!.book.id, 'ideal');
  assert.equal(rec!.band.ideal, true);
  assert.match(rec!.reason, /覆盖率 95%/);
});

test('recommendBook：无理想区间时贴近 94% 且给对应建议', () => {
  const known = new Set(['apple']);
  const easy = mk('easy', rep('apple', 20));        // 100% easy
  const stretch = mk('stretch', [...rep('apple', 16), ...rep('zebra', 4)]); // 80% stretch
  const rec = recommendBook([easy, stretch], known);
  assert.ok(rec);
  assert.equal(rec!.book.id, 'easy'); // |100-94|=6 < |80-94|=14 → easy 更贴近 94
  assert.match(rec!.reason, /轻松/);
});

test('coldStartPick：无分级书返回 null', () => {
  assert.equal(coldStartPick([mk('novel', rep('apple', 5))]), null);
});

test('coldStartPick：挑最低级别，同级优先未读', () => {
  const b1 = { ...mk('b1', rep('apple', 5)), level: 'B1' };
  const a1read = { ...mk('a1read', rep('apple', 5), 40), level: 'A1' };
  const a1new = { ...mk('a1new', rep('apple', 5)), level: 'A1' };
  const pick = coldStartPick([b1, a1read, a1new]);
  assert.ok(pick);
  assert.equal(pick!.book.id, 'a1new');
  assert.match(pick!.reason, /已掌握/);
});
