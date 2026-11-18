import { test, expect } from './base';

// 词汇本：筛选/排序/批量选择/批量删除+撤销，全部 live。
test('词汇本筛选+批量删除+撤销', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: /词汇笔记本/ }).click();
  await page.locator('.vocab-row').first().waitFor();
  const total = await page.locator('.vocab-row').count();

  // 筛选：熟悉（种子无>=3）→ 空；学习中 → 全部
  await page.getByRole('button', { name: '熟悉', exact: true }).click();
  await expect(page.locator('.vocab-row')).toHaveCount(0);
  await page.getByRole('button', { name: '学习中', exact: true }).click();
  await expect(page.locator('.vocab-row')).toHaveCount(total);

  // 排序切换不崩溃
  await page.locator('.sort-select').selectOption('word');
  await expect(page.locator('.vocab-row').first()).toBeVisible();

  // 批量：全选→删除→确认→撤销恢复
  await page.getByRole('button', { name: /批量/ }).click();
  await expect(page.locator('.bulk-bar')).toBeVisible();
  await page.getByRole('button', { name: '全选当前' }).click();
  await expect(page.locator('.bulk-bar')).toContainText(`已选 ${total} 个`);
  await page.getByRole('button', { name: /删除所选/ }).click();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.locator('.vocab-row')).toHaveCount(0);
  await expect(page.locator('.toast-undo')).toBeVisible();
  await page.locator('.toast-undo').click();
  await expect(page.locator('.vocab-row')).toHaveCount(total);
  expect(pageErrors).toEqual([]);
});

test('导出卡片：CSV 下载含表头与语境', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /词汇笔记本/ }).click();
  await page.locator('.vocab-row').first().waitFor();
  await page.getByRole('button', { name: /导出卡片/ }).click();
  await expect(page.getByText('导出卡片到 Anki / CSV')).toBeVisible();
  await page.getByRole('button', { name: 'CSV', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /下载 .csv/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/linguaflow-cards-.*\.csv/);
  const path = await download.path();
  const fs = await import('node:fs');
  const content = fs.readFileSync(path, 'utf-8');
  expect(content.startsWith('Word,Sentence,Meaning,Phonetic,Source')).toBe(true);
});

test('导入已知词：解析并标为已掌握', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: /词汇笔记本/ }).click();
  await page.getByRole('button', { name: /导入已知词/ }).click();
  await page.locator('.known-textarea').fill('apple\nbanana, cherry');
  await expect(page.locator('.known-modal .export-count')).toContainText('3');
  await page.getByRole('button', { name: /标为已掌握/ }).click();
  await expect(page.locator('.toast')).toContainText('已把 3 个词');
  expect(pageErrors).toEqual([]);
});

test('词汇本发音：详情发音按钮播放词库真人录音（OSS），而非浏览器 TTS', async ({ page }) => {
  // 把种子词 attention mock 进词库（含美式录音位），验证词汇本发音走 OSS 真人录音。
  const index = { chunk: 100, count: 1, cefr: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'], topics: [['mind', '心智']], words: [['attention', 'attention', 'n. 注意力', 'əˈtenʃən', 0, 1, 4]] };
  const block0 = [{ w: 'attention', uk: 'əˈtenʃən', us: 'əˈtenʃən', senses: [{ pos: 'n.', zh: '注意力', en: 'mental focus' }] }];
  await page.route('**/atlas/index.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(index) }));
  await page.route('**/atlas/entries/0.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(block0) }));
  await page.route('**/atlas/v1/audio/**', (route) => route.fulfill({ contentType: 'audio/mpeg', body: Buffer.from([]) }));
  await page.goto('/');
  await page.getByRole('button', { name: /词汇笔记本/ }).click();
  await page.locator('.vocab-row').first().waitFor();
  await page.locator('.vocab-row', { hasText: 'attention' }).locator('.vocab-main').click();
  await expect(page.locator('.word-detail')).toBeVisible();

  const reqPromise = page.waitForRequest('**/atlas/v1/audio/us/attention.mp3', { timeout: 8000 });
  await page.locator('.word-detail-head .icon-button').click();
  const req = await reqPromise;
  expect(req.url()).toContain('pathmora.oss-cn-beijing.aliyuncs.com/atlas/v1/audio/us/attention.mp3');
});
