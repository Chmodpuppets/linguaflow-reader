import { test, expect } from '@playwright/test';

test('首页加载：7 项导航齐全、书库可见、无未捕获异常', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');

  await expect(page.locator('.main-nav .nav-item')).toHaveCount(7);
  await expect(page.locator('.library-page')).toBeVisible();
  await expect(page.locator('.book-card')).toHaveCount(11);
  expect(pageErrors).toEqual([]);
});

test('导航可切到口语实验室与设置页（懒加载 chunk 正常）', async ({ page }) => {
  await page.goto('/');

  await page.locator('.main-nav .nav-item', { hasText: '口语实验室' }).click();
  await expect(page.locator('.main-nav .nav-item.active')).toContainText('口语实验室');

  await page.locator('.main-nav .nav-item', { hasText: '阅读设置' }).click();
  await expect(page.locator('.settings-page')).toBeVisible();
  // 用精确的 heading 角色：getByText('本地工作区') 会同时命中状态文案「本地工作区已就绪」而触发 strict mode violation。
  await expect(page.getByRole('heading', { name: '本地工作区', exact: true })).toBeVisible();
});

test('7 项导航全部可渲染（含懒加载的统计页）', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');

  const routes: { nav: string; landmark: string }[] = [
    { nav: '我的书库', landmark: '.library-page' },
    { nav: '词汇笔记本', landmark: '.vocabulary-page' },
    { nav: '主动复习', landmark: '.review-page' },
    { nav: '口语实验室', landmark: '.voice-lab-page' },
    { nav: '声波与成长统计', landmark: '.voice-analytics-page' },
    { nav: '标记与笔记', landmark: '.notes-page' },
    { nav: '阅读设置', landmark: '.settings-page' },
  ];
  for (const route of routes) {
    await page.locator('.main-nav .nav-item', { hasText: route.nav }).click();
    await expect(page.locator(route.landmark)).toBeVisible();
    await expect(page.locator('.main-nav .nav-item.active')).toContainText(route.nav);
  }
  expect(pageErrors).toEqual([]);
});

test('打开样书进入阅读器（Reader 懒加载 chunk），可返回书库', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');

  await page.locator('.book-card').first().getByRole('button', { name: '继续阅读' }).click();
  await expect(page.locator('.reader-page')).toBeVisible();
  await expect(page.locator('.chapter-body p').first()).toBeVisible();

  await page.getByRole('button', { name: '返回书库' }).click();
  await expect(page.locator('.library-page')).toBeVisible();
  expect(pageErrors).toEqual([]);
});
