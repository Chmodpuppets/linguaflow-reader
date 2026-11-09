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
