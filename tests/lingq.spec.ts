import { test, expect } from '@playwright/test';

// LingQ 式「导入任何文本」+ 学习仪表盘（已知词/连续天数/每日目标）。
test('粘贴文本导入为书，标记已掌握后仪表盘已知词 +1', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.goal-strip')).toBeVisible();

  await page.getByRole('button', { name: '粘贴文本' }).click();
  await page.locator('.text-import input').fill('A Quiet Garden');
  await page.locator('.text-import textarea').fill('Attention is a garden.\n\nThe spotlight of the mind wanders among the flowers.');
  await page.getByRole('button', { name: '导入为可阅读的书' }).click();

  await expect(page.locator('.reader-page')).toBeVisible();
  await expect(page.locator('.chapter-body')).toContainText('spotlight');

  // 标记一个词为已掌握 → 仪表盘已知词计数 +1
  await page.locator('.word[data-word="spotlight"]').click();
  await page.locator('.state-btn.known').click();
  await page.getByRole('button', { name: '返回原文' }).click();
  await page.getByRole('button', { name: '返回书库' }).click();
  await expect(page.locator('.goal-strip')).toBeVisible();
  await expect(page.locator('.goal-stat').first()).toContainText('1');
  expect(pageErrors).toEqual([]);
});

test('TXT 文件导入 + 每日目标可调', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '导入 EPUB' }).click();
  await page.locator('input[type="file"][accept*="epub"]').setInputFiles({ name: 'article.txt', mimeType: 'text/plain', buffer: Buffer.from('The morning light fell across the quiet street.\n\nA child laughed somewhere beyond the gate.') });
  await expect(page.locator('.reader-page')).toBeVisible();
  await expect(page.locator('.chapter-body')).toContainText('morning light');
  await page.getByRole('button', { name: '返回书库' }).click();

  // 提高每日目标 5→6
  await page.getByRole('button', { name: '提高每日目标' }).click();
  await expect(page.locator('.goal-today b')).toContainText('/6');
});
