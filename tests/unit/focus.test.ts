import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickFocus, selfCompareText } from '../../src/lib/focus';
import type { DiffToken } from '../../src/types';
import type { ProsodyWord } from '../../src/lib/prosody';

const tok = (text: string, status: DiffToken['status'], spoken?: string): DiffToken => ({ text, status, spoken, confidence: 1 });
const pw = (word: string, status: ProsodyWord['status']): ProsodyWord => ({ word, status, energy: 0.5, voiced: 0.5 });

test('pickFocus：漏读优先于重音弱', () => {
  const f = pickFocus({ tokens: [tok('world', 'missing')], prosody: [pw('world', 'weak')] });
  assert.equal(f?.kind, 'missing');
  assert.equal(f?.word, 'world');
});

test('pickFocus：无漏读时选重音弱', () => {
  const f = pickFocus({ tokens: [tok('the', 'match')], prosody: [pw('the', 'match'), pw('world', 'weak')] });
  assert.equal(f?.kind, 'weak');
  assert.equal(f?.word, 'world');
});

test('pickFocus：无弱读时选拖长', () => {
  const f = pickFocus({ tokens: [], prosody: [pw('being', 'long')] });
  assert.equal(f?.kind, 'long');
});

test('pickFocus：停顿偏多', () => {
  const f = pickFocus({ tokens: [], prosody: [], pauseRatioPct: 50 });
  assert.equal(f?.kind, 'pause');
});

test('pickFocus：口头禅', () => {
  const f = pickFocus({ tokens: [], prosody: [], pauseRatioPct: 10, fillerCount: 3 });
  assert.equal(f?.kind, 'filler');
});

test('pickFocus：替换兜底', () => {
  const f = pickFocus({ tokens: [tok('curiosity', 'substitute', 'curious')], prosody: [], pauseRatioPct: 5, fillerCount: 0 });
  assert.equal(f?.kind, 'substitute');
  assert.equal(f?.word, 'curiosity');
});

test('pickFocus：全匹配且无问题→null', () => {
  const f = pickFocus({ tokens: [tok('the', 'match')], prosody: [pw('the', 'match')], pauseRatioPct: 5, fillerCount: 0 });
  assert.equal(f, null);
});

test('selfCompareText：自评与系统一致', () => {
  const f = pickFocus({ tokens: [tok('world', 'missing')] });
  assert.match(selfCompareText('missing', f), /一致/);
});

test('selfCompareText：自评与系统不一致', () => {
  const f = pickFocus({ tokens: [tok('world', 'missing')] });
  assert.match(selfCompareText('pause', f), /不一致/);
});

test('selfCompareText：自评挺顺但系统有问题', () => {
  const f = pickFocus({ tokens: [tok('world', 'missing')] });
  assert.match(selfCompareText('smooth', f), /但系统发现/);
});

test('selfCompareText：自评挺顺且系统无问题', () => {
  assert.match(selfCompareText('smooth', null), /保持/);
});

test('selfCompareText：未知选项→空串', () => {
  assert.equal(selfCompareText('nope', null), '');
});
