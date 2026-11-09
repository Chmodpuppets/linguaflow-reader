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
