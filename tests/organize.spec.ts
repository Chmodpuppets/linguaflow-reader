import { test, expect } from './base';

// 书库组织：标签 + 按标签筛选 + 保存的视图，全部 live。
test('书籍标签 + 按标签筛选 + 保存视图', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await page.locator('.book-card').first().waitFor();
  const total = await page.locator('.book-card').count();

  // 给第一本书打标签
  await page.locator('.book-card').first().locator('[aria-label*="加标签"]').click();
  await page.locator('.tag-input').fill('科幻');
  await page.getByRole('button', { name: /保存标签/ }).click();
  await expect(page.locator('.book-tag', { hasText: '科幻' }).first()).toBeVisible();
  await expect(page.locator('.tag-chips .filter-chip', { hasText: '科幻' })).toBeVisible();

  // 按标签筛选 → 只剩这本；点全部恢复
  await page.locator('.tag-chips .filter-chip', { hasText: '科幻' }).click();
  await expect(page.locator('.book-card')).toHaveCount(1);
  await page.locator('.tag-chips .filter-chip', { hasText: '全部' }).click();
  await expect(page.locator('.book-card')).toHaveCount(total);

  // 保存当前视图（带搜索词），之后清空再应用视图能还原
  await page.getByLabel('搜索书库').fill('Alice');
  await page.locator('.views-button').click();
  await page.getByLabel('视图名称').fill('爱丽丝视图');
  await page.getByRole('button', { name: /保存当前视图/ }).click();
  await expect(page.locator('.views-list li', { hasText: '爱丽丝视图' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByLabel('搜索书库').fill('');
  await page.locator('.views-button').click();
  await page.locator('.view-apply', { hasText: '爱丽丝视图' }).click();
  await expect(page.getByLabel('搜索书库')).toHaveValue('Alice');
  expect(pageErrors).toEqual([]);
});
