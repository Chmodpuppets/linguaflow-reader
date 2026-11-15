import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classicBooks } from '../../src/data/classics';

test('经典书架：6 本真实公版/改写内容，均多段且无 CEFR 徽章', () => {
  assert.equal(classicBooks.length, 6);
  for (const b of classicBooks) {
    assert.equal(b.source, 'sample');
    assert.equal(b.level, undefined, `${b.id} 不应带分级徽章`);
    assert.ok(b.chapters.length >= 1);
    const paras = b.chapters.flatMap((c) => c.paragraphs);
    assert.ok(paras.length >= 6, `${b.id} 段落过少`);
    // 真实正文：总字数充足，且不含 Gutenberg 许可证残留
    const words = paras.join(' ').split(/\s+/).length;
    assert.ok(words > 120, `${b.id} 正文过短`);
    assert.ok(!/Gutenberg|PROJECT GUTENBERG|www\.gutenberg\.org/i.test(paras.join(' ')), `${b.id} 含许可证残留`);
  }
});

test('小王子为原创分级改写（不抓版权全文）', () => {
  const p = classicBooks.find((b) => b.id === 'the-little-prince-retelling');
  assert.ok(p);
  assert.match(p!.author, /原创分级改写/);
  assert.ok(p!.chapters[0].paragraphs.length >= 6);
});
