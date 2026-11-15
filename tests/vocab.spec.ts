import { test, expect } from './base';

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

test('导出卡片：CSV 下载含表头与语境', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /词汇笔记本/ }).click();
  await page.locator('.vocab-row').first().waitFor();
  await page.getByRole('button', { name: /导出卡片/ }).click();
  await expect(page.getByText('导出卡片到 Anki / CSV')).toBeVisible();
  await page.getByRole('button', { name: 'CSV', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /下载 .csv/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/linguaflow-cards-.*\.csv/);
  const path = await download.path();
  const fs = await import('node:fs');
  const content = fs.readFileSync(path, 'utf-8');
  expect(content.startsWith('Word,Sentence,Meaning,Phonetic,Source')).toBe(true);
});

test('导入已知词：解析并标为已掌握', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: /词汇笔记本/ }).click();
  await page.getByRole('button', { name: /导入已知词/ }).click();
  await page.locator('.known-textarea').fill('apple\nbanana, cherry');
  await expect(page.locator('.known-modal .export-count')).toContainText('3');
  await page.getByRole('button', { name: /标为已掌握/ }).click();
  await expect(page.locator('.toast')).toContainText('已把 3 个词');
  expect(pageErrors).toEqual([]);
});
