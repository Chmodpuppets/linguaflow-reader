import { test, expect } from '@playwright/test';

// 学习记录上云是 opt-in：默认关闭不收集；开启并连接账号后，查词等事件才上报。
test('学习记录同步 opt-in：默认关闭，开启连接后查词上报 /learn/events', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.route('**/api/auth/login', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ token: 'e2e-token', user: { id: 'u', username: 'e2e' } }) }));
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
  await page.locator('.sync-field input').first().fill('e2e@example.com');
  await page.locator('.sync-field input[type="password"]').fill('pass123');
  await page.getByRole('button', { name: '连接账号' }).click();
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

// P2：连接账号后复习页拉取 pathmora 下发的今日计划并展示横幅；计划不可达时回退本地 SRS。
test('复习页执行 pathmora 下发的今日计划（横幅+计划请求），不可达回退本地', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.route('**/api/auth/login', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ token: 'e2e-token', user: { id: 'u', username: 'e2e' } }) }));
  await page.route('**/api/learn/events', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: 0 }) }));
  await page.route('**/api/reader/plan', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, generatedAt: new Date().toISOString(), todayMinutes: 10, readingRewardMinutes: 15, due: [{ word: 'subtle', misses: 2, kind: 'weak' }, { word: 'attention', misses: 0, kind: 'reinforce' }], stats: { weakCount: 1, reinforceCount: 1, knownCount: 1, savedSentences: 0, activityDays: 1 } }) }));

  await page.goto('/');
  await page.getByRole('button', { name: /阅读设置/ }).click();
  await page.getByRole('switch', { name: '同步学习记录' }).click();
  await page.locator('.sync-field input').first().fill('e2e@example.com');
  await page.locator('.sync-field input[type="password"]').fill('pass123');
  await page.getByRole('button', { name: '连接账号' }).click();
  await expect(page.getByText('账号已连接')).toBeVisible();

  const planReq = page.waitForRequest('**/api/reader/plan', { timeout: 10000 });
  await page.getByRole('button', { name: /主动复习/ }).click();
  const req = await planReq;
  expect(req.headers()['authorization']).toBe('Bearer e2e-token');
  await expect(page.locator('.plan-banner')).toBeVisible();
  await expect(page.locator('.plan-banner')).toContainText('PATHMORA');
  await expect(page.locator('.plan-banner')).toContainText('1 个薄弱词');
  expect(pageErrors).toEqual([]);
});

// P3：连接账号后书库按已知词（/learn/summary）显示难度徽章（覆盖率+分档）。
test('书库难度匹配：连接后按已知词显示覆盖率徽章', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.route('**/api/auth/login', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ token: 'e2e-token', user: { id: 'u', username: 'e2e' } }) }));
  await page.route('**/api/learn/events', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: 0 }) }));
  await page.route('**/api/learn/summary', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ knownWords: ['attention', 'curiosity', 'notice', 'world', 'interesting'], weakWords: [], counts: {}, savedSentences: 0, shadow: { sessions: 0, avgAccuracy: 0, avgWpm: 0 }, activityDays: 1 }) }));

  await page.goto('/');
  // 未连接：无已知词来源时不渲染难度徽章（本地种子若无已掌握词）。
  await page.getByRole('button', { name: /阅读设置/ }).click();
  await page.getByRole('switch', { name: '同步学习记录' }).click();
  await page.locator('.sync-field input').first().fill('e2e@example.com');
  await page.locator('.sync-field input[type="password"]').fill('pass123');
  await page.getByRole('button', { name: '连接账号' }).click();
  await expect(page.getByText('账号已连接')).toBeVisible();

  const summaryReq = page.waitForRequest('**/api/learn/summary', { timeout: 10000 });
  await page.getByRole('button', { name: /我的书库/ }).click();
  const req = await summaryReq;
  expect(req.headers()['authorization']).toBe('Bearer e2e-token');
  const badge = page.locator('.difficulty-badge').first();
  await expect(badge).toBeVisible();
  await expect(badge).toContainText('%');
  // 选书推荐工具条：难度匹配排序 + 只看 i+1 筛选，切换不崩溃。
  await expect(page.locator('.library-tools')).toBeVisible();
  await page.getByRole('button', { name: /难度匹配/ }).click();
  await page.getByRole('button', { name: /只看 i\+1/ }).click();
  await expect(page.locator('.book-grid, .empty-state').first()).toBeVisible();
  expect(pageErrors).toEqual([]);
});
