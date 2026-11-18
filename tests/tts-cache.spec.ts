import { test, expect } from './base';

// TTS 结果持久缓存：同一 (文本,音色,模型) 绝不重复花上游 API 额度。
// L2 本机 IndexedDB（刷新后 0 请求）；L3 服务端 OSS 共享缓存（登录态命中/落盘）。
const goSettings = async (page: import('@playwright/test').Page) => {
  await page.locator('.main-nav .nav-item', { hasText: '阅读设置' }).click();
  await expect(page.locator('.settings-page')).toBeVisible();
};
const configureDashscope = async (page: import('@playwright/test').Page) => {
  const card = page.locator('.tts-card');
  await card.locator('.segmented button', { hasText: '阿里云百炼' }).click();
  await card.locator('.tts-field', { hasText: 'DashScope API Key' }).locator('input').fill('sk-cache-test');
};
const AUDIO_BYTES = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x01, 0x02, 0x03, 0x04]);

test('TTS 本机持久缓存：试听合成一次，刷新后再试听 0 上游请求', async ({ page }) => {
  let synthCalls = 0;
  await page.route('**/api/v1/services/aigc/multimodal-generation/generation', async (route) => {
    synthCalls += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: { audio: { data: 'UklGRg==' } } }) });
  });
  await page.goto('/');
  await goSettings(page);
  await configureDashscope(page);
  await page.locator('.tts-card button', { hasText: '试听' }).click();
  await expect(page.locator('.toast', { hasText: '试听成功' })).toBeVisible();
  expect(synthCalls).toBe(1);
  // 等 fire-and-forget 的 IndexedDB 落盘完成，再刷新（会话缓存清空，仅持久层可用）
  await page.waitForTimeout(700);
  await page.reload();
  await goSettings(page);
  await page.locator('.tts-card button', { hasText: '试听' }).click();
  await expect(page.locator('.toast', { hasText: '试听成功' })).toBeVisible();
  expect(synthCalls).toBe(1); // 刷新后命中本机缓存，未再调上游
});

test('TTS OSS 共享缓存：登录态先查 /tts/audio，命中则不调上游', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pathmora_auth_token', 'test-token'));
  let synthCalls = 0;
  let ossGets = 0;
  await page.route('**/api/tts/audio**', async (route) => {
    if (route.request().method() === 'GET') {
      ossGets += 1;
      await route.fulfill({ status: 200, contentType: 'audio/mpeg', body: AUDIO_BYTES });
    } else {
      await route.fulfill({ status: 200, contentType: 'audio/mpeg', body: AUDIO_BYTES });
    }
  });
  await page.route('**/api/v1/services/aigc/multimodal-generation/generation', async (route) => {
    synthCalls += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: { audio: { data: 'UklGRg==' } } }) });
  });
  await page.goto('/');
  await goSettings(page);
  await configureDashscope(page);
  await page.locator('.tts-card button', { hasText: '试听' }).click();
  await expect(page.locator('.toast', { hasText: '试听成功' })).toBeVisible();
  expect(ossGets).toBeGreaterThanOrEqual(1);
  expect(synthCalls).toBe(0); // OSS 命中，直接复用，未花上游额度
});

test('TTS OSS 落盘：未命中时合成后 POST /tts/audio 持久化（带 ns/voice/text）', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pathmora_auth_token', 'test-token'));
  let posted: any = null;
  await page.route('**/api/tts/audio**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not cached' }) });
    } else {
      posted = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({ status: 200, contentType: 'audio/mpeg', body: AUDIO_BYTES, headers: { 'X-Tts-Stored': '1' } });
    }
  });
  await page.route('**/api/v1/services/aigc/multimodal-generation/generation', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: { audio: { data: 'UklGRg==' } } }) });
  });
  await page.goto('/');
  await goSettings(page);
  await configureDashscope(page);
  await page.locator('.tts-card button', { hasText: '试听' }).click();
  await expect(page.locator('.toast', { hasText: '试听成功' })).toBeVisible();
  await expect.poll(() => posted, { timeout: 8000 }).not.toBeNull();
  expect(posted.voice).toBe('Cherry');
  expect(posted.ns).toContain('r1ds');
  expect(posted.text).toContain('voice preview');
  expect(posted.data).toBeTruthy();
});
