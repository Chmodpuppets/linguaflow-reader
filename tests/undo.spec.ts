import { test, expect } from '@playwright/test';

// 破坏性操作可撤销：删除标记/收藏句子后 toast 提供「撤销」，点击即恢复。
test('删除标记后可撤销恢复', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: /标记与笔记/ }).click();
  await page.locator('.notes-grid .note-card').first().waitFor();
  const before = await page.locator('.notes-grid .note-card').count();
  await page.getByRole('button', { name: '删除标记' }).first().click();
  await expect(page.locator('.notes-grid .note-card')).toHaveCount(before - 1);
  await expect(page.locator('.toast-undo')).toBeVisible();
  await page.locator('.toast-undo').click();
  await expect(page.locator('.notes-grid .note-card')).toHaveCount(before);
  expect(pageErrors).toEqual([]);
});

test('删除收藏句子（确认）后可撤销恢复', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: /标记与笔记/ }).click();
  await expect(page.locator('.sentence-card')).toHaveCount(1);
  await page.getByRole('button', { name: '删除收藏句子' }).click();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.locator('.sentence-card')).toHaveCount(0);
  await expect(page.locator('.toast-undo')).toBeVisible();
  await page.locator('.toast-undo').click();
  await expect(page.locator('.sentence-card')).toHaveCount(1);
  expect(pageErrors).toEqual([]);
});
