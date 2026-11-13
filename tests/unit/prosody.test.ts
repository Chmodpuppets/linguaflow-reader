import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyProsody, intelligibilityGaps, wordFeaturesFromBuffer, type AudioBufferLike } from '../../src/lib/prosody';
import { diffTranscript } from '../../src/lib/voice';

test('intelligibilityGaps：只取 substitute/missing，带 spoken 与 kind', () => {
  const tokens = diffTranscript('the quick brown fox', 'the quick blue fox');
  // brown→blue 为 substitute；再构造一个 missing
  const tokens2 = diffTranscript('the quick brown fox', 'the quick fox');
  const gaps = intelligibilityGaps([...tokens, ...tokens2]);
  assert.ok(gaps.some((g) => g.word === 'brown' && g.kind === 'substitute' && g.spoken === 'blue'));
  assert.ok(gaps.some((g) => g.word === 'brown' && g.kind === 'missing'));
  assert.ok(gaps.every((g) => g.kind === 'substitute' || g.kind === 'missing'));
});

test('classifyProsody：原音重读你却弱读 → weak', () => {
  const words = ['a', 'b'];
  const target = [{ energy: 1, voiced: 1 }, { energy: 0.2, voiced: 1 }];
  const user = [{ energy: 0.1, voiced: 1 }, { energy: 1, voiced: 1 }];
  const out = classifyProsody(words, target, user);
  assert.equal(out[0].status, 'weak');
});

test('classifyProsody：原音弱读你却拖长 → long', () => {
  const words = ['a', 'b'];
  const target = [{ energy: 0.2, voiced: 1 }, { energy: 1, voiced: 1 }];
  const user = [{ energy: 1, voiced: 1 }, { energy: 1, voiced: 1 }];
  const out = classifyProsody(words, target, user);
  assert.equal(out[0].status, 'long');
});

test('classifyProsody：节奏一致 → match', () => {
  const out = classifyProsody(['a'], [{ energy: 1, voiced: 1 }], [{ energy: 1, voiced: 1 }]);
  assert.equal(out[0].status, 'match');
});

function stubBuffer(samples: Float32Array, sampleRate = 1000): AudioBufferLike {
  return { duration: samples.length / sampleRate, sampleRate, numberOfChannels: 1, getChannelData: () => samples };
}

test('wordFeaturesFromBuffer：裁首尾静音、按词等分提取能量/浊音', () => {
  const samples = new Float32Array(1000);
  for (let i = 200; i < 800; i += 1) samples[i] = 0.5;
  const features = wordFeaturesFromBuffer(stubBuffer(samples), 2);
  assert.equal(features.length, 2);
  for (const f of features) {
    assert.ok(f.energy > 0.4, `energy=${f.energy}`);
    assert.ok(f.voiced > 0.9, `voiced=${f.voiced}`);
  }
});

test('wordFeaturesFromBuffer：全静音 → 能量 0；词数 0 → 空', () => {
  const silent = wordFeaturesFromBuffer(stubBuffer(new Float32Array(1000)), 3);
  assert.ok(silent.every((f) => f.energy === 0));
  assert.deepEqual(wordFeaturesFromBuffer(stubBuffer(new Float32Array(1000)), 0), []);
});
