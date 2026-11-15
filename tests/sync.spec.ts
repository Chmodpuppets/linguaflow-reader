import { test, expect } from './base';

// 跨标签页同步：整份快照「最后写赢」曾让停在旧快照的标签页抹掉另一标签页刚收藏的词。
// 修复后每次写盘广播最新快照，其它标签页按 rev 采纳，不再覆盖。
async function importText(page: import('@playwright/test').Page, title: string, text: string) {
  await page.getByRole('button', { name: '导入书籍' }).click();
  await page.getByRole('group', { name: '导入方式' }).getByRole('button', { name: '粘贴文本' }).click();
  await page.locator('.text-import input').fill(title);
  await page.locator('.text-import textarea').fill(text);
  await page.getByRole('button', { name: '导入为可阅读的书' }).click();
  await page.locator('.reader-page').waitFor();
}

test('另一标签页的写盘不会抹掉本标签刚收藏的词', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const other = await context.newPage();

  // 两个标签页都先加载（此时都是空快照 rev0）
  await page.goto('/');
  await other.goto('/');
  await page.getByRole('button', { name: '导入书籍' }).waitFor();
  await other.getByRole('button', { name: '导入书籍' }).waitFor();

  // A 导入书并收藏 curious → 写盘 rev1 并广播
  await importText(page, 'Sync A', 'The curious cat sat on the warm mat.');
  await page.locator('.chapter-body [data-word="curious"]').first().click();
  await page.locator('.lookup-panel').waitFor();
  await page.getByRole('button', { name: /收藏单词|已在词汇本/ }).click();
  await expect(page.locator('.toast')).toContainText('已收藏 curious');
  await page.waitForTimeout(900); // 等 A 防抖落盘 + 广播，B 采纳

  // B 此时应已采纳 A 的快照；B 再导入第二本书触发整份写盘（旧实现会用 B 的空快照覆盖掉 curious）
  await importText(other, 'Sync B', 'A second book about a quiet forest.');
  await other.waitForTimeout(900);

  // 重新加载 A：curious 必须仍在
  await page.reload();
  await page.getByRole('button', { name: /词汇笔记本/ }).click();
  await expect(page.locator('.vocab-row .vocab-word strong', { hasText: 'curious' })).toHaveCount(1);
  expect(errors).toEqual([]);
  await other.close();
});
