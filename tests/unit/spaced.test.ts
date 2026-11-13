import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupShadowings, dueShadowings, nextIntervalDays } from '../../src/lib/spacedShadowing';
import type { VoiceRecord } from '../../src/types';

const rec = (id: string, text: string, at: string, wpm: number, accuracy: number, mode: VoiceRecord['mode'] = 'shadowing'): VoiceRecord => ({
  id, mode, targetText: text, transcript: text, diffTokens: [],
  metrics: { wpm, pauseRatio: 10, accuracy, duration: 5, wordCount: 8, fillerCount: 0 },
  createdAt: at,
});
const DAY = 86400000;
const now = Date.parse('2026-11-14T00:00:00Z');
const ago = (d: number) => new Date(now - d * DAY).toISOString();

test('groupShadowings：按归一化文本分组、尝试升序、计算进步', () => {
  const groups = groupShadowings([
    rec('a', 'The world is interesting.', ago(3), 80, 60),
    rec('b', 'the world is interesting.', ago(1), 100, 80),
    rec('c', 'Other sentence here.', ago(2), 90, 70),
  ]);
  assert.equal(groups.length, 2);
  const g = groups.find((x) => x.count === 2)!;
  assert.equal(g.firstWpm, 80);
  assert.equal(g.latestWpm, 100);
  assert.equal(g.deltaWpm, 20);
  assert.equal(g.deltaAccuracy, 20);
  assert.equal(g.attempts[0].at, ago(3));
});

test('groupShadowings：忽略非跟读与空目标', () => {
  const groups = groupShadowings([rec('a', 'x', ago(1), 80, 60, 'freetalk'), rec('b', '   ', ago(1), 80, 60)]);
  assert.equal(groups.length, 0);
});

test('nextIntervalDays：1/3/7 封顶', () => {
  assert.equal(nextIntervalDays(1), 1);
  assert.equal(nextIntervalDays(2), 3);
  assert.equal(nextIntervalDays(3), 7);
  assert.equal(nextIntervalDays(9), 7);
});

test('dueShadowings：到期判定与排序', () => {
  const groups = groupShadowings([
    rec('a', 'sentence one.', ago(2), 80, 60),   // count1 interval1 → due
    rec('b', 'sentence two.', ago(0.5), 80, 60), // count1 interval1 → not due
    rec('c', 'sentence three.', ago(4), 80, 60), // count1 interval1 → due, older
  ]);
  const due = dueShadowings(groups, now);
  assert.equal(due.length, 2);
  assert.equal(due[0].group.targetText, 'sentence three.');
  assert.equal(due[1].group.targetText, 'sentence one.');
});

test('dueShadowings：多次练习后间隔变长', () => {
  const groups = groupShadowings([rec('a', 's.', ago(2), 80, 60), rec('b', 's.', ago(2), 90, 70)]);
  // count2 → interval3，lastAt=2天前 → 未到期
  assert.equal(dueShadowings(groups, now).length, 0);
});
