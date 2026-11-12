import { test, expect } from '@playwright/test';

// 学习记录上云是 opt-in：默认关闭不收集；开启并连接账号后，查词等事件才上报。
test('学习记录同步 opt-in：默认关闭，开启连接后查词上报 /learn/events', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.route('**/api/auth/register', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ token: 'e2e-token', user: { id: 'u', username: 'e2e' } }) }));
  await page.route('**/api/learn/events', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: 1 }) }));
  await page.route('**/api/dict/lookup*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ found: true, lang: 'en', word: 'attention', phonetic: '', meaning: 'n. 注意', pos: 'n' }) }));

  await page.goto('/');
  await page.getByRole('button', { name: /阅读设置/ }).click();
  await expect(page.getByRole('heading', { name: '学习记录同步（可选）' })).toBeVisible();
  // 默认关闭：不渲染账号表单。
  await expect(page.locator('.sync-form')).toHaveCount(0);

  // 开启 → 出现创建账号表单；连接后显示已连接。
  await page.getByRole('switch', { name: '同步学习记录' }).click();
  await expect(page.locator('.sync-form')).toBeVisible();
  await page.locator('.sync-field input').first().fill('e2e');
  await page.locator('.sync-field input[type="password"]').fill('pass123');
  await page.getByRole('button', { name: '创建并连接' }).click();
  await expect(page.getByText('账号已连接')).toBeVisible();

  // 回书库打开一本书，点一个词 → 触发 lookup 事件上报。
  await page.getByRole('button', { name: /我的书库/ }).click();
  await page.locator('.book-card .book-cover').first().click();
  await expect(page.locator('.reader-page')).toBeVisible();
  const reported = page.waitForRequest('**/api/learn/events', { timeout: 10000 });
  await page.locator('.chapter-body .word').first().click();
  const req = await reported;
  const body = JSON.parse(req.postData() || '{}');
  expect(Array.isArray(body.events)).toBe(true);
  expect(body.events.some((e: { type: string }) => e.type === 'lookup')).toBe(true);
  expect(pageErrors).toEqual([]);
});
