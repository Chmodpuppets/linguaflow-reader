import { test, expect } from '@playwright/test';

test('首页加载：7 项导航齐全、书库可见、无未捕获异常', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');

  await expect(page.locator('.main-nav .nav-item')).toHaveCount(7);
  await expect(page.locator('.library-page')).toBeVisible();
  await expect(page.locator('.book-card')).toHaveCount(3);
  expect(pageErrors).toEqual([]);
});

test('导航可切到口语实验室与设置页（懒加载 chunk 正常）', async ({ page }) => {
  await page.goto('/');

  await page.locator('.main-nav .nav-item', { hasText: '口语实验室' }).click();
  await expect(page.locator('.main-nav .nav-item.active')).toContainText('口语实验室');

  await page.locator('.main-nav .nav-item', { hasText: '阅读设置' }).click();
  await expect(page.locator('.settings-page')).toBeVisible();
  await expect(page.getByText('本地工作区')).toBeVisible();
});
