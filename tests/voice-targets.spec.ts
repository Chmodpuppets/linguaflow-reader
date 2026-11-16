import { test, expect } from './base';
import { test as plain, expect as plainExpect } from '@playwright/test';

// 口语实验室练习目标：收藏句卡片轨（取代下拉），收藏句优先、分组 Tab、搜索、试听、点卡即练。
test('收藏句以卡片呈现并默认选中，可切 Tab/搜索/点卡切换', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: '导入书籍' }).click();
  await page.getByRole('group', { name: '导入方式' }).getByRole('button', { name: '粘贴文本' }).click();
  await page.locator('.text-import input').fill('Voice Source');
  await page.locator('.text-import textarea').fill('The curious fox wanders through the quiet forest every morning.');
  await page.getByRole('button', { name: '导入为可阅读的书' }).click();
  await page.locator('.reader-page').waitFor();

  // 轻点单词 → 查词面板 → 收藏句子
  await page.locator('[data-word="curious"]').first().click();
  await page.getByRole('button', { name: '收藏句子' }).click();
  await expect(page.getByRole('button', { name: '已收藏句子' })).toBeVisible();

  // 进口语实验室：卡片轨而非下拉
  await page.locator('.main-nav .nav-item', { hasText: '口语实验室' }).click();
  await page.locator('.voice-lab-page').waitFor();
  await expect(page.locator('.practice-picker')).toBeVisible();
  await expect(page.locator('.practice-tab.active')).toContainText('我的收藏句');
  const savedCard = page.locator('.practice-card', { hasText: 'curious fox' });
  await expect(savedCard).toHaveCount(1);
  await expect(savedCard).toHaveClass(/selected/);
  await expect(savedCard.locator('.practice-listen')).toHaveCount(1);
  await expect(savedCard.locator('.practice-words')).toContainText('词');

  // 搜索过滤
  await page.getByLabel('搜索练习句').fill('curious');
  await expect(page.locator('.practice-card')).toHaveCount(1);
  await page.getByLabel('搜索练习句').fill('zzzznomatch');
  await expect(page.locator('.practice-rail-empty')).toBeVisible();
  await page.getByLabel('搜索练习句').fill('');

  // 切到书中段落 Tab，点卡即设为当前练习句
  await page.locator('.practice-tab', { hasText: '书中段落' }).click();
  const firstPara = page.locator('.practice-card').first();
  await expect(firstPara).toBeVisible();
  await firstPara.click();
  await expect(firstPara).toHaveClass(/selected/);
  expect(pageErrors).toEqual([]);
});

// 默认空书架（无内置书）：没有任何收藏/标记/正文时给引导提示，而非系统刷出的内容。
plain('空书架时练习目标给引导提示', async ({ page }) => {
  await page.goto('/');
  await page.locator('.main-nav .nav-item', { hasText: '口语实验室' }).click();
  await page.locator('.voice-lab-page').waitFor();
  await plainExpect(page.locator('.practice-empty-hint')).toBeVisible();
  await plainExpect(page.locator('.practice-card')).toHaveCount(0);
});
