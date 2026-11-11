import { test, expect } from '@playwright/test';

// 移动视口（Pixel 7，由 playwright.config 的 mobile-chrome project 注入）：
// 桌面用例不覆盖的底部导航 / 抽屉导航 / 窄屏阅读器布局在这里验证。
test('移动视口：底部导航与抽屉可达，书库与阅读器渲染无横向溢出', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');

  await expect(page.locator('.library-page')).toBeVisible();
  await expect(page.locator('.mobile-header')).toBeVisible();
  await expect(page.locator('.mobile-tabs')).toBeVisible();

  // 底部导航进设置
  await page.locator('.mobile-tabs button', { hasText: 'Settings' }).click();
  await expect(page.locator('.settings-page')).toBeVisible();

  // 打开抽屉导航切到词汇本
  await page.locator('.mobile-tabs button', { hasText: 'Library' }).click();
  await page.getByRole('button', { name: '打开导航' }).click();
  await expect(page.locator('.sidebar.mobile-open')).toBeVisible();
  await page.locator('.sidebar .nav-item', { hasText: '词汇笔记本' }).click();
  await expect(page.locator('.vocabulary-page')).toBeVisible();

  // 打开一本书进入阅读器
  await page.locator('.mobile-tabs button', { hasText: 'Library' }).click();
  await page.locator('.book-card').first().getByRole('button', { name: '继续阅读' }).click();
  await expect(page.locator('.reader-page')).toBeVisible();
  await expect(page.locator('.chapter-body p').first()).toBeVisible();

  // 窄屏不应出现横向滚动
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});
