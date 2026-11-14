import { test, expect } from '@playwright/test';

// 词汇本：筛选/排序/批量选择/批量删除+撤销，全部 live。
test('词汇本筛选+批量删除+撤销', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: /词汇笔记本/ }).click();
  await page.locator('.vocab-row').first().waitFor();
  const total = await page.locator('.vocab-row').count();

  // 筛选：熟悉（种子无>=3）→ 空；学习中 → 全部
  await page.getByRole('button', { name: '熟悉', exact: true }).click();
  await expect(page.locator('.vocab-row')).toHaveCount(0);
  await page.getByRole('button', { name: '学习中', exact: true }).click();
  await expect(page.locator('.vocab-row')).toHaveCount(total);

  // 排序切换不崩溃
  await page.locator('.sort-select').selectOption('word');
  await expect(page.locator('.vocab-row').first()).toBeVisible();

  // 批量：全选→删除→确认→撤销恢复
  await page.getByRole('button', { name: /批量/ }).click();
  await expect(page.locator('.bulk-bar')).toBeVisible();
  await page.getByRole('button', { name: '全选当前' }).click();
  await expect(page.locator('.bulk-bar')).toContainText(`已选 ${total} 个`);
  await page.getByRole('button', { name: /删除所选/ }).click();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.locator('.vocab-row')).toHaveCount(0);
  await expect(page.locator('.toast-undo')).toBeVisible();
  await page.locator('.toast-undo').click();
  await expect(page.locator('.vocab-row')).toHaveCount(total);
  expect(pageErrors).toEqual([]);
});
