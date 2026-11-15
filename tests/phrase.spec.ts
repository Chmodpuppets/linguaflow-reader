import { test, expect } from './base';

// 短语 / 习语收藏：划选多词 → 存为短语（不折叠成单词）→ 词汇本短语筛选可见。
test('划选多词存为短语，词汇本按短语筛选可见', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: '导入书籍' }).click();
  await page.getByRole('group', { name: '导入方式' }).getByRole('button', { name: '粘贴文本' }).click();
  await page.locator('.text-import input').fill('Phrase Test');
  await page.locator('.text-import textarea').fill('He decided to give up smoking and look after his health.');
  await page.getByRole('button', { name: '导入为可阅读的书' }).click();
  await page.locator('.reader-page').waitFor();

  // 用鼠标从 give 划到 up，选中整个短语
  const give = page.locator('.chapter-body [data-word="give"]').first();
  const up = page.locator('.chapter-body [data-word="up"]').first();
  const gb = await give.boundingBox();
  const ub = await up.boundingBox();
  expect(gb && ub).toBeTruthy();
  await page.mouse.move(gb!.x + 2, gb!.y + gb!.height / 2);
  await page.mouse.down();
  await page.mouse.move(ub!.x + ub!.width - 2, ub!.y + ub!.height / 2, { steps: 6 });
  await page.mouse.up();

  await expect(page.locator('.selection-popover')).toBeVisible();
  await page.getByRole('button', { name: '存为短语' }).click();
  await expect(page.locator('.phrase-modal')).toBeVisible();
  await expect(page.locator('.phrase-head h3')).toContainText('give up');
  await page.locator('#phrase-meaning').fill('放弃');
  await page.getByRole('button', { name: /收藏短语/ }).click();
  await expect(page.locator('.toast')).toContainText('已收藏短语');

  // 回到词汇本，按「短语」筛选应看到 give up + 短语徽章
  await page.getByRole('button', { name: '返回书库' }).click();
  await page.getByRole('button', { name: /词汇笔记本/ }).click();
  await page.getByRole('button', { name: '短语', exact: true }).click();
  await expect(page.locator('.vocab-row')).toHaveCount(1);
  await expect(page.locator('.vocab-row .vocab-word strong')).toHaveText('give up');
  await expect(page.locator('.vocab-row .phrase-badge')).toBeVisible();
  expect(pageErrors).toEqual([]);
});
