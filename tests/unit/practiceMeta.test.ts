import { test } from 'node:test';
import assert from 'node:assert/strict';
import { practiceMetaMap, metaFor, wordCount, defaultTarget } from '../../src/lib/practiceMeta';
import type { PracticeTarget } from '../../src/lib/practiceTargets';
import type { VoiceRecord } from '../../src/types';

const NOW = Date.parse('2026-11-16T00:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW - n * 86400000).toISOString();

function mkRecord(targetText: string, accuracy: number, createdAt: string): VoiceRecord {
  return {
    id: `r-${targetText}-${createdAt}`, mode: 'shadowing', targetText, transcript: targetText, diffTokens: [],
    metrics: { wpm: 120, pauseRatio: 0.1, accuracy, duration: 5, wordCount: 8, fillerCount: 0 },
    createdAt,
  };
}
function mkTarget(id: string, text: string, group: PracticeTarget['group']): PracticeTarget {
  return { id, text, source: 'S', group };
}

test('practiceMetaMap 聚合次数/最近准确率/到期', () => {
  const records = [mkRecord('Hello world', 70, daysAgo(9)), mkRecord('Hello world', 88, daysAgo(8))];
  const map = practiceMetaMap(records, NOW);
  const meta = metaFor('Hello world', map);
  assert.equal(meta.count, 2);
  assert.equal(meta.lastAccuracy, 88);
  assert.equal(meta.due, true); // count=2 → 间隔 3 天，已过 8 天 → 到期
});

test('未练过的目标返回空徽章', () => {
  const map = practiceMetaMap([], NOW);
  assert.deepEqual(metaFor('anything', map), { count: 0, lastAccuracy: null, due: false });
});

test('刚练过（1 天内）不到期', () => {
  const map = practiceMetaMap([mkRecord('Fresh sentence', 90, daysAgo(0))], NOW);
  assert.equal(metaFor('Fresh sentence', map).due, false);
});

test('wordCount 按空白计词', () => {
  assert.equal(wordCount('  The curious   fox runs  '), 4);
  assert.equal(wordCount(''), 0);
});

test('defaultTarget：到期句优先', () => {
  const targets = [mkTarget('s1', 'A normal sentence', 'sentence'), mkTarget('s2', 'Hello world', 'sentence')];
  const map = practiceMetaMap([mkRecord('Hello world', 80, daysAgo(8))], NOW);
  assert.equal(defaultTarget(targets, map)?.id, 's2');
});

test('defaultTarget：无到期则取第一句收藏句，再退列表第一个', () => {
  const map = practiceMetaMap([], NOW);
  const withSentence = [mkTarget('p1', 'a paragraph', 'paragraph'), mkTarget('s1', 'a sentence', 'sentence')];
  assert.equal(defaultTarget(withSentence, map)?.id, 's1');
  const onlyParagraph = [mkTarget('p1', 'a paragraph', 'paragraph')];
  assert.equal(defaultTarget(onlyParagraph, map)?.id, 'p1');
  assert.equal(defaultTarget([], map), undefined);
});
