import { test, expect } from '@playwright/test';

// 默认（无内置开关）空书架：用户自导入；支持一次多本。
test('默认空书架 + 一次导入多本', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.book-card')).toHaveCount(0);
  await expect(page.getByText('书架还是空的')).toBeVisible();

  await page.getByRole('button', { name: '导入书籍' }).click();
  await page.locator('.dropzone input[type="file"]').setInputFiles([
    { name: 'book-one.txt', mimeType: 'text/plain', buffer: Buffer.from('The first book begins here.\n\nA second paragraph follows.') },
    { name: 'book-two.txt', mimeType: 'text/plain', buffer: Buffer.from('Another book opens quietly.\n\nIts second paragraph waits.') },
  ]);
  // 批量导入结束后停留在最后一本的阅读器；返回书库应见两本。
  await page.getByRole('button', { name: '返回书库' }).click();
  await expect(page.locator('.book-card')).toHaveCount(2);
  expect(pageErrors).toEqual([]);
});
