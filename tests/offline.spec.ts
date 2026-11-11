import { test, expect } from '@playwright/test';

/**
 * 覆盖之前只靠静态验证、没做过浏览器 E2E 的两处修复：
 *  1. SW install 通过 precache-manifest.json 预缓存全部懒加载 chunk（离线首启不再 503）
 *  2. latin-ext 字体带 unicode-range，不预缓存、改为运行时按需
 *
 * 直接检查 Cache Storage 而不是真的断网 —— 时序稳定，且能精确断言「哪些资源进了缓存」。
 */
test('SW 预缓存覆盖全部构建 assets，且不预缓存 latin-ext', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; return true; });

  // 等 install 的 addAll 跑完：主缓存里至少有 10 条
  await page.waitForFunction(async () => {
    const keys = await caches.keys();
    const main = keys.find((key) => !key.endsWith('-runtime'));
    if (!main) return false;
    const cache = await caches.open(main);
    return (await cache.keys()).length >= 10;
  }, undefined, { timeout: 30_000 });

  const cached: string[] = await page.evaluate(async () => {
    const keys = await caches.keys();
    const main = keys.find((key) => !key.endsWith('-runtime'));
    if (!main) return [];
    const cache = await caches.open(main);
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  });

  const response = await page.request.get('/precache-manifest.json');
  expect(response.ok()).toBeTruthy();
  const manifest = (await response.json()) as { assets: string[] };

  for (const asset of manifest.assets.filter((item) => !item.includes('latin-ext'))) {
    expect(cached).toContain(asset);
  }
  expect(cached.some((path) => path.includes('latin-ext'))).toBe(false);
});

test('latin-ext 字体在出现变音字母时按需请求并进运行时缓存', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; return true; });
  // 页面必须已被 SW 控制，字体请求才会走 fetch handler 进运行时缓存。
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, { timeout: 10_000 });

  // 等预缓存完成，避免 install 与运行时写入互相干扰。
  await page.waitForFunction(async () => {
    const keys = await caches.keys();
    const main = keys.find((key) => !key.endsWith('-runtime'));
    if (!main) return false;
    return (await (await caches.open(main)).keys()).length >= 10;
  }, undefined, { timeout: 30_000 });

  // U+0100–024F 范围的字符：只有真出现时浏览器才会请求 latin-ext 子集。
  await page.evaluate(async () => {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:fixed;left:-9999px;font-family:"Inter Variable";font-size:16px;';
    probe.textContent = 'ąęćżłń';
    document.body.appendChild(probe);
    await document.fonts.load('16px "Inter Variable"', 'ąęćżłń');
    probe.remove();
  });

  await page.waitForFunction(async () => {
    const keys = await caches.keys();
    const runtime = keys.find((key) => key.endsWith('-runtime'));
    if (!runtime) return false;
    const entries = await (await caches.open(runtime)).keys();
    return entries.some((request) => request.url.includes('latin-ext'));
  }, undefined, { timeout: 15_000 });
});

test('真实断网后仍可打开应用并导航到懒加载页（SW 离线首启）', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; return true; });
  // 等预缓存跑完，确保外壳 + 懒加载 chunk 都已入缓存。
  await page.waitForFunction(async () => {
    const keys = await caches.keys();
    const main = keys.find((key) => !key.endsWith('-runtime'));
    if (!main) return false;
    return (await (await caches.open(main)).keys()).length >= 10;
  }, undefined, { timeout: 30_000 });

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'load' });
    await expect(page.locator('.library-page')).toBeVisible();
    await page.locator('.main-nav .nav-item', { hasText: '口语实验室' }).click();
    await expect(page.locator('.voice-lab-page')).toBeVisible();
    await page.locator('.main-nav .nav-item', { hasText: '声波与成长统计' }).click();
    await expect(page.locator('.voice-analytics-page')).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
