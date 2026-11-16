import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
// lib.js 是经典脚本（非模块）。测试被 esbuild 编译到缓存目录运行，相对路径会失效，
// 故用基于项目根（process.cwd()）的绝对路径 require，执行副作用即在 globalThis 挂上 LFExt。
createRequire(import.meta.url)(resolve(process.cwd(), 'extension/lib.js'));

const LF = (globalThis as unknown as { LFExt: {
  isPhrase: (t: string) => boolean;
  wordCount: (t: string) => number;
  contextSentence: (p: string, t: string) => string;
  makeItem: (options: { kind?: string; selection: string; paragraph?: string; url?: string; title?: string }) => { id: string; kind: string; text: string; context: string; sourceUrl: string };
  mergeQueue: (queue: unknown[], item: unknown) => unknown[];
  removeByIds: (queue: Array<{ id: string }>, ids: string[]) => Array<{ id: string }>;
  MAX_QUEUE: number;
} }).LFExt;

test('isPhrase / wordCount：多词为短语，单词不是', () => {
  assert.equal(LF.isPhrase('give up'), true);
  assert.equal(LF.isPhrase('hello'), false);
  assert.equal(LF.wordCount('  a  b  c '), 3);
});

test('contextSentence：从段落中截取含选区的整句', () => {
  const paragraph = 'He decided to give up smoking. It was hard. He looked after himself.';
  assert.equal(LF.contextSentence(paragraph, 'give up'), 'He decided to give up smoking.');
  assert.equal(LF.contextSentence(paragraph, 'looked after'), 'He looked after himself.');
});

test('contextSentence：找不到时回退段落（截断）', () => {
  const paragraph = 'x'.repeat(500);
  const ctx = LF.contextSentence(paragraph, 'absent');
  assert.ok(ctx.length <= 240);
});

test('makeItem：生成带 id / 语境 / 来源的条目', () => {
  const item = LF.makeItem({ kind: 'word', selection: 'serendipity', paragraph: 'It was pure serendipity.', url: 'https://example.com', title: 'Example' });
  assert.equal(item.kind, 'word');
  assert.equal(item.text, 'serendipity');
  assert.equal(item.context, 'It was pure serendipity.');
  assert.equal(item.sourceUrl, 'https://example.com');
  assert.ok(item.id.length > 0);
});

test('mergeQueue：按文本键去重，新条目置顶', () => {
  const a = LF.makeItem({ selection: 'hello' });
  const b = LF.makeItem({ selection: 'world' });
  const dup = LF.makeItem({ selection: 'Hello' });
  const queue = LF.mergeQueue([a, b], dup);
  // hello 被新版本 Hello 替换且置顶，world 保留，不产生重复条目。
  assert.equal(queue.length, 2);
  assert.equal((queue[0] as { text: string }).text, 'Hello');
  assert.equal((queue[1] as { text: string }).text, 'world');
});

test('mergeQueue：超过上限截断', () => {
  let queue: unknown[] = [];
  for (let i = 0; i < LF.MAX_QUEUE + 50; i += 1) queue = LF.mergeQueue(queue, LF.makeItem({ selection: `w${i}` }));
  assert.equal(queue.length, LF.MAX_QUEUE);
});

test('removeByIds：按 id 移除', () => {
  const queue = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(LF.removeByIds(queue, ['b']).map((item) => item.id), ['a', 'c']);
  assert.deepEqual(LF.removeByIds(queue, []).map((item) => item.id), ['a', 'b', 'c']);
});
