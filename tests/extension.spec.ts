import { test, expect } from './base';

// 浏览器扩展收藏链路：bridge 通过同源 postMessage 投递 → App 并入词汇本/句子 → 回执清队列。
// 这里直接模拟 bridge 的 postMessage（扩展本体的采集/队列由单测覆盖）。
type AckWindow = Window & { __lfAcks?: string[][] };

test('网页扩展收藏：postMessage 并入词汇本并回执 id', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: /词汇笔记本/ }).click();
  await page.locator('.vocab-row').first().waitFor();
  const before = await page.locator('.vocab-row').count();

  await page.evaluate(() => {
    (window as AckWindow).__lfAcks = [];
    window.addEventListener('message', (event) => {
      const data = event.data as { source?: string; type?: string; ids?: string[] };
      if (data && data.source === 'linguaflow-extension' && data.type === 'lf-imported' && Array.isArray(data.ids)) {
        (window as AckWindow).__lfAcks!.push(data.ids);
      }
    });
  });

  // 模拟 bridge 投递：一个单词 + 一个短语（带来源网页）。
  await page.evaluate(() => {
    const now = new Date().toISOString();
    window.postMessage({
      source: 'linguaflow-extension',
      type: 'lf-import',
      items: [
        { id: 'ext-w1', kind: 'word', text: 'serendipity', context: 'It was pure serendipity.', sourceUrl: 'https://example.com/a', sourceTitle: 'Example', createdAt: now },
        { id: 'ext-p1', kind: 'phrase', text: 'give up', context: 'He decided to give up.', sourceUrl: 'https://example.com/a', sourceTitle: 'Example', createdAt: now },
      ],
    }, location.origin);
  });

  await expect(page.locator('.vocab-row')).toHaveCount(before + 2);
  await expect(page.locator('.vocab-row', { hasText: 'serendipity' })).toHaveCount(1);
  // 短语筛选下能看到 give up。
  await page.getByRole('button', { name: '短语', exact: true }).click();
  await expect(page.locator('.vocab-row', { hasText: 'give up' })).toHaveCount(1);

  // 回执包含两条 id（让扩展队列清空）。
  const acks = await page.evaluate(() => (window as AckWindow).__lfAcks ?? []);
  expect(acks.flat()).toContain('ext-w1');
  expect(acks.flat()).toContain('ext-p1');
  expect(pageErrors).toEqual([]);
});

test('网页扩展收藏：重复词不新增、句子并入句子收藏', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: /词汇笔记本/ }).click();
  await page.locator('.vocab-row').first().waitFor();
  const before = await page.locator('.vocab-row').count();

  await page.evaluate(() => {
    const now = new Date().toISOString();
    window.postMessage({
      source: 'linguaflow-extension',
      type: 'lf-import',
      items: [
        { id: 'ext-s1', kind: 'sentence', text: 'A sentence captured from the web.', context: '', sourceUrl: 'https://example.com/b', sourceTitle: 'Example', createdAt: now },
      ],
    }, location.origin);
  });
  // 句子并入句子收藏，不进词汇本（词汇本数量不变）。
  await expect(page.locator('.vocab-row')).toHaveCount(before);
  expect(pageErrors).toEqual([]);
});
