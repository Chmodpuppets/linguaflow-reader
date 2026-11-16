import { test, expect } from './base';

// 跨书全文搜索：在正文里找词/短语，点击结果跳到原文段落（带落点高亮）。
test('全文搜索命中并跳转到原文段落', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: '导入书籍' }).click();
  await page.getByRole('group', { name: '导入方式' }).getByRole('button', { name: '粘贴文本' }).click();
  await page.locator('.text-import input').fill('Lantern Tale');
  await page.locator('.text-import textarea').fill('The village slept quietly under the snow.\n\nA small zorblight glowed beside the old wooden door.\n\nChildren whispered stories about the light.');
  await page.getByRole('button', { name: '导入为可阅读的书' }).click();
  await page.locator('.reader-page').waitFor();
  await page.getByRole('button', { name: '返回书库' }).click();

  await page.getByRole('button', { name: '全文搜索' }).click();
  await page.getByLabel('全文搜索关键词').fill('zorblight');
  const hit = page.locator('.search-hit');
  await expect(hit).toHaveCount(1);
  await expect(hit.locator('mark')).toHaveText('zorblight');
  await expect(hit.locator('.hit-source')).toContainText('Lantern Tale');
  await hit.click();

  // 跳转到该书第 2 段（index 1），落点段落短暂高亮
  await page.locator('.reader-page').waitFor();
  await page.locator('#paragraph-1.paragraph-flash').waitFor({ timeout: 5000 });
  await expect(page.locator('.chapter-body')).toContainText('zorblight');
  expect(pageErrors).toEqual([]);
});

test('全文搜索无结果与空查询提示', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '全文搜索' }).click();
  await expect(page.locator('.fulltext-modal .modal-lead')).toBeVisible();
  await page.getByLabel('全文搜索关键词').fill('qqqqzzzznotaword');
  await expect(page.locator('.fulltext-modal .views-empty')).toContainText('没有找到');
  await expect(page.locator('.search-hit')).toHaveCount(0);
});
