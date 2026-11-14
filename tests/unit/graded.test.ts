import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradedBooks, gradedGlosses } from '../../src/data/gradedReaders';
import { chapterWords, chapterStats } from '../../src/lib/annotation';

test('分级书架：A1/A2 各两本 + B1 三本(含爱丽丝桥) + B2 两本原著桥、正文非空、source=sample', () => {
  assert.equal(gradedBooks.length, 9);
  const perLevel: Record<string, number> = { A1: 2, A2: 2, B1: 3, B2: 2 };
  for (const [level, n] of Object.entries(perLevel)) {
    assert.equal(gradedBooks.filter((b) => b.level === level).length, n, level);
  }
  for (const b of gradedBooks) {
    assert.equal(b.source, 'sample');
    assert.ok(b.chapters[0].paragraphs.length >= 4, b.id);
  }
  const bridge = gradedBooks.find((b) => b.level === 'B2');
  assert.ok(bridge && /Gatsby/.test(bridge.title), 'B2 原著桥应为盖茨比');
});

test('分级注音：预置释义覆盖书中真实词', () => {
  const all = gradedBooks.flatMap((b) => chapterWords(b.chapters[0].paragraphs));
  for (const key of Object.keys(gradedGlosses)) assert.ok(all.includes(key), `gloss ${key} not in text`);
});

test('分级覆盖率：全已知=100%，部分已知介于其间', () => {
  const paras = gradedBooks[0].chapters[0].paragraphs;
  const words = chapterWords(paras);
  const allKnown = Object.fromEntries(words.map((w) => [w, 'known' as const]));
  assert.equal(chapterStats(paras, allKnown, {}, 'learning').coveragePct, 100);
  const some = chapterStats(paras, { the: 'known', a: 'known', and: 'known' }, {}, 'learning');
  assert.ok(some.coveragePct > 0 && some.coveragePct < 100);
});
