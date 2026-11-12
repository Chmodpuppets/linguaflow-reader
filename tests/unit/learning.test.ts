import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { recordEvent, flushQueue, pendingCount, isSyncEnabled, setSyncEnabled, setSyncToken, getSyncToken, connectAccount } from '../../src/lib/learning';

// learning.ts 依赖 localStorage / navigator / fetch；在 node 里用可控替身。
const store: Record<string, string> = {};
let online = false;
let fetchCalls: { url: string; init: RequestInit }[] = [];
let fetchOk = true;
let fetchBody: unknown = { ok: true, accepted: 0 };

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  online = false;
  fetchCalls = [];
  fetchOk = true;
  fetchBody = { ok: true, accepted: 0 };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = String(v); } } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { get onLine() { return online; } } });
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    fetchCalls.push({ url, init });
    return { ok: fetchOk, status: fetchOk ? 200 : 500, json: async () => fetchBody } as Response;
  }) as typeof fetch;
});

test('默认关闭：未开启同步不收集任何事件', () => {
  assert.equal(isSyncEnabled(), false);
  recordEvent({ type: 'lookup', word: 'x' });
  assert.equal(pendingCount(), 0);
});

test('开启后入队，联网补传清空并带 Bearer', async () => {
  setSyncEnabled(true);
  setSyncToken('tok');
  online = false;
  recordEvent({ type: 'lookup', word: 'a' });
  recordEvent({ type: 'review', word: 'b', payload: { result: 'good' } });
  assert.equal(pendingCount(), 2);
  online = true;
  const r = await flushQueue();
  assert.equal(r.sent, 2);
  assert.equal(r.pending, 0);
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0].url, /\/learn\/events$/);
  assert.equal((fetchCalls[0].init.headers as Record<string, string>).Authorization, 'Bearer tok');
  const body = JSON.parse(String(fetchCalls[0].init.body));
  assert.equal(body.events.length, 2);
});

test('离线时保留队列不丢', async () => {
  setSyncEnabled(true);
  setSyncToken('tok');
  online = false;
  recordEvent({ type: 'lookup', word: 'a' });
  const r = await flushQueue();
  assert.equal(r.sent, 0);
  assert.equal(r.pending, 1);
});

test('服务器失败保留队列待重试', async () => {
  setSyncEnabled(true);
  setSyncToken('tok');
  online = true;
  fetchOk = false;
  recordEvent({ type: 'lookup', word: 'a' });
  const r = await flushQueue();
  assert.equal(r.pending, 1);
});

test('connectAccount 成功后保存 token', async () => {
  online = true;
  fetchBody = { token: 'abc' };
  const r = await connectAccount('user', 'pass123', 'register');
  assert.equal(r.ok, true);
  assert.equal(getSyncToken(), 'abc');
});
