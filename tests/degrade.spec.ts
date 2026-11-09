import { test, expect } from '@playwright/test';

/**
 * 公开仓库不含 `public/local-content/*.json`（第三方书籍正文，不随仓库分发）。
 * 新 clone / CI 天然处于「缺本机素材」状态，这里验证安静降级而不是白屏或抛错。
 */
test('缺本机书籍 JSON 时降级为 3 本样书，不出现内置扫描书', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');

  await expect(page.locator('.book-card')).toHaveCount(3);
  await expect(page.getByText('Diary of a Wimpy Kid')).toHaveCount(0);
  await expect(page.locator('.library-page')).toBeVisible();
  expect(pageErrors).toEqual([]);
});
