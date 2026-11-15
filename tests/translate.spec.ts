import { test, expect } from './base';

// 整句机器翻译：查词面板「翻译整句」与选区「翻译」都走 /translate（这里 mock，确定且不依赖外网）。
const MOCK_ZH = '他决定戒烟，并照顾自己的健康。';

test.beforeEach(async ({ page }) => {
  await page.route('**/translate**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, text: MOCK_ZH, source: 'mymemory' }),
  }));
});

async function importBook(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '导入书籍' }).click();
  await page.getByRole('group', { name: '导入方式' }).getByRole('button', { name: '粘贴文本' }).click();
  await page.locator('.text-import input').fill('Translate Test');
  await page.locator('.text-import textarea').fill('He decided to give up smoking and look after his health.');
  await page.getByRole('button', { name: '导入为可阅读的书' }).click();
  await page.locator('.reader-page').waitFor();
}

test('查词面板「翻译整句」显示中文译文', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await importBook(page);
  await page.locator('.chapter-body [data-word="decided"]').first().click();
  await expect(page.locator('.lookup-panel')).toBeVisible();
  await page.getByRole('button', { name: '翻译整句' }).click();
  await expect(page.locator('.sentence-translation')).toContainText(MOCK_ZH);
  await expect(page.locator('.translation-label')).toContainText('机器翻译');
  expect(pageErrors).toEqual([]);
});

test('选区「翻译」打开查词面板并自动翻译整句', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await importBook(page);
  const decided = page.locator('.chapter-body [data-word="decided"]').first();
  const smoking = page.locator('.chapter-body [data-word="smoking"]').first();
  const db = await decided.boundingBox();
  const sb = await smoking.boundingBox();
  expect(db && sb).toBeTruthy();
  await page.mouse.move(db!.x + 2, db!.y + db!.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb!.x + sb!.width - 2, sb!.y + sb!.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.selection-popover')).toBeVisible();
  await page.getByRole('button', { name: '翻译', exact: true }).click();
  await expect(page.locator('.lookup-panel')).toBeVisible();
  await expect(page.locator('.sentence-translation')).toContainText(MOCK_ZH);
  expect(pageErrors).toEqual([]);
});
