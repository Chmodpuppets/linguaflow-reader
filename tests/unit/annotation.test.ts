import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chapterWords, rubyGlossFor, chapterStats } from '../../src/lib/annotation';
import type { WordGloss, WordState } from '../../src/types';

const glosses: Record<string, WordGloss> = {
  vulnerable: { zh: '易受影响的' },
  advice: { zh: '建议' },
};

test('chapterWords 小写去重、过滤短词', () => {
  const words = chapterWords(['The cat and the CAT.', 'A dog!']);
  assert.deepEqual(words.sort(), ['and', 'cat', 'dog', 'the']);
});

test('rubyGlossFor：off 模式一律不注音', () => {
  const states: Record<string, WordState> = { vulnerable: 'learning' };
  assert.equal(rubyGlossFor('vulnerable', 'off', states, glosses), null);
});

test('rubyGlossFor：learning 模式只注学习中的词', () => {
  const states: Record<string, WordState> = { vulnerable: 'learning', advice: 'known' };
  assert.equal(rubyGlossFor('vulnerable', 'learning', states, glosses), '易受影响的');
  assert.equal(rubyGlossFor('advice', 'learning', states, glosses), null); // 已掌握移除
  assert.equal(rubyGlossFor('unknown', 'learning', states, glosses), null); // 未标记不注
});

test('rubyGlossFor：all 模式注所有有释义的词（含已掌握/未标记）', () => {
  const states: Record<string, WordState> = { advice: 'known' };
  assert.equal(rubyGlossFor('advice', 'all', states, glosses), '建议');
  assert.equal(rubyGlossFor('vulnerable', 'all', states, glosses), '易受影响的');
});

test('rubyGlossFor：无释义缓存不注音', () => {
  const states: Record<string, WordState> = { nope: 'learning' };
  assert.equal(rubyGlossFor('nope', 'learning', states, glosses), null);
});

test('chapterStats：覆盖率与裸页率随状态变化', () => {
  const paragraphs = ['vulnerable advice cat'];
  const states: Record<string, WordState> = { vulnerable: 'known', advice: 'learning' };
  const stats = chapterStats(paragraphs, states, glosses, 'learning');
  assert.equal(stats.total, 3);
  assert.equal(stats.known, 1);
  assert.equal(stats.learning, 1);
  assert.equal(stats.coveragePct, 33);
  // learning 模式下只有 advice 注音 → 裸页 2/3
  assert.equal(stats.barePct, 67);
});

test('rubyGlossFor：释义缓存未命中时回退 fallback（Word Atlas 离线词库），门控不变', () => {
  const states: Record<string, WordState> = { curious: 'learning', cat: 'known', dog: 'learning' };
  const fallback = (w: string): WordGloss | null => (w === 'curious' ? { zh: '好奇的' } : w === 'cat' ? { zh: '猫' } : null);
  // learning 词无缓存 → 用 fallback 注音
  assert.equal(rubyGlossFor('curious', 'learning', states, glosses, fallback), '好奇的');
  // known 词在 learning 模式仍不注（门控优先于 fallback）
  assert.equal(rubyGlossFor('cat', 'learning', states, glosses, fallback), null);
  // all 模式下 known 词用 fallback 注音
  assert.equal(rubyGlossFor('cat', 'all', states, glosses, fallback), '猫');
  // 缓存优先于 fallback
  assert.equal(rubyGlossFor('vulnerable', 'learning', { vulnerable: 'learning' }, glosses, () => ({ zh: '别的' })), '易受影响的');
  // off 模式即使有 fallback 也不注
  assert.equal(rubyGlossFor('curious', 'off', states, glosses, fallback), null);
});

test('chapterStats：fallback 透传后裸页率下降', () => {
  const paragraphs = ['curious cat'];
  const states: Record<string, WordState> = { curious: 'learning', cat: 'learning' };
  const fallback = (w: string): WordGloss | null => (w === 'curious' ? { zh: '好奇的' } : null);
  const noFb = chapterStats(paragraphs, states, glosses, 'learning');
  const withFb = chapterStats(paragraphs, states, glosses, 'learning', fallback);
  assert.equal(noFb.barePct, 100); // 无缓存全裸
  assert.equal(withFb.barePct, 50); // curious 经 fallback 注音
});
