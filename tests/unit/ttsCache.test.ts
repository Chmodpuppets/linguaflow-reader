import test from 'node:test';
import assert from 'node:assert/strict';
import { clearDurableTts, ossCacheReady, ttsCacheStats } from '../../src/lib/ttsCache';

// node 环境无 IndexedDB / localStorage：缓存概览与清空必须安静降级，不抛错、不阻断发音。
test('ossCacheReady 无登录 token 时为 false', () => {
  assert.equal(ossCacheReady(), false);
});

test('ttsCacheStats 无 IDB 时返回零值概览', async () => {
  const stats = await ttsCacheStats();
  assert.equal(stats.count, 0);
  assert.equal(stats.bytes, 0);
  assert.equal(typeof stats.ossReady, 'boolean');
});

test('clearDurableTts 无 IDB 时安静完成不抛错', async () => {
  await clearDurableTts();
});
