import { test, expect } from './base';

// 书籍元数据编辑：导入/内置书都能改书名、作者、简介、封面，且随备份持久化（刷新仍在）。
test('编辑书籍书名作者并保存，书卡更新且刷新后仍在', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  const card = page.locator('.book-card').first();
  await card.waitFor();
  await card.locator('.icon-button[aria-label*="编辑"]').click();
  await page.getByLabel('书名', { exact: true }).fill('我的自定义书名');
  await page.getByLabel('作者', { exact: true }).fill('自定义作者');
  await page.getByLabel('简介', { exact: true }).fill('一段自定义简介。');
  await page.getByRole('button', { name: /保存修改/ }).click();
  await expect(page.locator('.book-card h3', { hasText: '我的自定义书名' })).toHaveCount(1);
  await expect(page.locator('.book-card', { hasText: '我的自定义书名' }).locator('.book-info > p', { hasText: '自定义作者' })).toHaveCount(1);
  // 刷新后元数据仍在（持久化）。元数据编辑不改集合长度，走 400ms 防抖落盘，先等它写盘。
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.locator('.book-card h3', { hasText: '我的自定义书名' })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('编辑弹窗可上传封面并预览（移除按钮出现）', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  const card = page.locator('.book-card').first();
  await card.waitFor();
  await card.locator('.icon-button[aria-label*="编辑"]').click();
  // 1×1 PNG dataURL 作为封面上传
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
  await page.locator('.book-edit-modal input[type="file"]').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.cover-preview img')).toBeVisible();
  await expect(page.getByRole('button', { name: /移除/ })).toBeVisible();
  expect(errors).toEqual([]);
});
