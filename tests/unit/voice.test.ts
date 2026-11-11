import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordTokens, diffTranscript, voiceMetrics, extractKeywords } from '../../src/lib/voice';

test('wordTokens：小写化，缩写与连字符保留为整词', () => {
  assert.deepEqual(wordTokens("Don't stop-me now!"), ["don't", 'stop-me', 'now']);
  assert.deepEqual(wordTokens('Hello, WORLD.'), ['hello', 'world']);
  assert.deepEqual(wordTokens(''), []);
});

test('diffTranscript：完全一致全部 match', () => {
  const tokens = diffTranscript('the quick brown fox', 'the quick brown fox');
  assert.equal(tokens.length, 4);
  assert.ok(tokens.every((t) => t.status === 'match'));
});

test('diffTranscript：漏读的词标 missing', () => {
  const tokens = diffTranscript('the quick brown fox', 'the quick fox');
  assert.equal(tokens.find((t) => t.text === 'brown')?.status, 'missing');
});

test('diffTranscript：替换词标 substitute 并带 spoken', () => {
  const tokens = diffTranscript('the quick brown fox', 'the quick blue fox');
  const sub = tokens.find((t) => t.status === 'substitute');
  assert.equal(sub?.text, 'brown');
  assert.equal(sub?.spoken, 'blue');
});

test('diffTranscript：多读的词标 extra', () => {
  const tokens = diffTranscript('the fox', 'the quick fox');
  assert.ok(tokens.some((t) => t.status === 'extra' && t.text === 'quick'));
});

test('diffTranscript：低置信度时匹配词标 low', () => {
  const tokens = diffTranscript('hello world', 'hello world', 0.5);
  assert.ok(tokens.every((t) => t.status === 'low'));
});

test('voiceMetrics：口头禅统计 um / you know，但排除 like', () => {
  const text = 'um I like you know like um going';
  const m = voiceMetrics(text, text, diffTranscript(text, text), 60, 0);
  assert.equal(m.fillerCount, 3);
  assert.equal(m.wordCount, wordTokens(text).length);
});

test('voiceMetrics：WPM 用去除卡顿后的时间', () => {
  const text = 'one two three four five six';
  const m = voiceMetrics(text, text, diffTranscript(text, text), 60, 0.5);
  assert.equal(m.wpm, 12);
  assert.equal(m.pauseRatio, 50);
});

test('extractKeywords：过滤停用词与短词，按词频排序', () => {
  assert.deepEqual(extractKeywords('attention attention attention curiosity curiosity the and', 2), ['attention', 'curiosity']);
});
