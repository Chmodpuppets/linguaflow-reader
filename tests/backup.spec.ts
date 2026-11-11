import { test, expect } from '@playwright/test';

test('非法备份用应用内 toast 提示，不弹原生 alert，页面不崩', async ({ page }) => {
  let dialogSeen = false;
  page.on('dialog', (dialog) => { dialogSeen = true; void dialog.dismiss(); });

  await page.goto('/');
  await page.locator('.main-nav .nav-item', { hasText: '阅读设置' }).click();

  await page.locator('input[type="file"][accept*="json"]').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"books":"not-an-array"}'),
  });

  await expect(page.locator('.toast')).toContainText('备份恢复失败');
  expect(dialogSeen).toBe(false);
  await expect(page.locator('.settings-page')).toBeVisible();
});

// 顶层形状合法但条目畸形：旧校验会放行，打开书时 Reader 直接抛错白屏。
// 现在必须在恢复入口整份拒绝，并说清原因。
test('畸形书籍条目（空 chapters 的 EPUB）被拒绝，不进入书库', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await page.locator('.main-nav .nav-item', { hasText: '阅读设置' }).click();

  const broken = {
    books: [{ id: 'x', title: 'Broken', source: 'epub', chapters: [] }],
    vocabulary: [], highlights: [], reviewLogs: [], voiceRecords: [],
    settings: { fontSize: 18, lineHeight: 1.8, theme: 'midnight', reducedAmbient: false },
  };
  await page.locator('input[type="file"][accept*="json"]').setInputFiles({
    name: 'broken-entry.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(broken)),
  });

  await expect(page.locator('.toast')).toContainText('备份恢复失败');
  await expect(page.locator('.toast')).toContainText('没有可阅读的章节');
  await page.locator('.main-nav .nav-item', { hasText: '我的书库' }).click();
  await expect(page.locator('.book-card')).toHaveCount(3);
  expect(pageErrors).toEqual([]);
});

test('畸形练习记录（缺 metrics / diffTokens）被拒绝', async ({ page }) => {
  await page.goto('/');
  await page.locator('.main-nav .nav-item', { hasText: '阅读设置' }).click();

  const broken = {
    books: [], vocabulary: [], highlights: [], reviewLogs: [],
    voiceRecords: [{ id: 'v' }],
    settings: { fontSize: 18, lineHeight: 1.8, theme: 'midnight', reducedAmbient: false },
  };
  await page.locator('input[type="file"][accept*="json"]').setInputFiles({
    name: 'broken-record.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(broken)),
  });

  await expect(page.locator('.toast')).toContainText('备份恢复失败');
  await expect(page.locator('.toast')).toContainText('口语练习记录损坏');
  await expect(page.locator('.settings-page')).toBeVisible();
});
