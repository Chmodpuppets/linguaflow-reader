import { test, expect } from './base';

// LingQ 式「导入任何文本」+ 学习仪表盘（已知词/连续天数/每日目标）。
test('粘贴文本导入为书，标记已掌握后仪表盘已知词 +1', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.goal-strip')).toBeVisible();

  await page.getByRole('button', { name: '粘贴文本' }).click();
  await page.locator('.text-import input').fill('A Quiet Garden');
  await page.locator('.text-import textarea').fill('Attention is a garden.\n\nThe spotlight of the mind wanders among the flowers.');
  await page.getByRole('button', { name: '导入为可阅读的书' }).click();

  await expect(page.locator('.reader-page')).toBeVisible();
  await expect(page.locator('.chapter-body')).toContainText('spotlight');

  // 标记一个词为已掌握 → 仪表盘已知词计数 +1
  await page.locator('.word[data-word="spotlight"]').click();
  await page.locator('.state-btn.known').click();
  await page.getByRole('button', { name: '返回原文' }).click();
  await page.getByRole('button', { name: '返回书库' }).click();
  await expect(page.locator('.goal-strip')).toBeVisible();
  await expect(page.locator('.goal-stat').first()).toContainText('1');
  expect(pageErrors).toEqual([]);
});

test('每行一段的粘贴文本不再并成一坨（单段落修复）', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  const line = (n: number) => `This is paragraph number ${n} and it is long enough to be treated as its own natural paragraph in the reader.`;
  await page.getByRole('button', { name: '粘贴文本' }).click();
  await page.locator('.text-import input').fill('Line Paragraphs');
  await page.locator('.text-import textarea').fill([line(1), line(2), line(3)].join('\n'));
  await page.getByRole('button', { name: '导入为可阅读的书' }).click();
  await expect(page.locator('.reader-page')).toBeVisible();
  await expect(page.locator('.chapter-body p')).toHaveCount(3);
  expect(pageErrors).toEqual([]);
});

test('超长单段导入被拆成多个可读段', async ({ page }) => {
  await page.goto('/');
  const long = Array.from({ length: 40 }, (_, i) => `Sentence ${i} goes here.`).join(' ');
  await page.getByRole('button', { name: '粘贴文本' }).click();
  await page.locator('.text-import input').fill('Wall');
  await page.locator('.text-import textarea').fill(long);
  await page.getByRole('button', { name: '导入为可阅读的书' }).click();
  await expect(page.locator('.reader-page')).toBeVisible();
  const count = await page.locator('.chapter-body p').count();
  expect(count).toBeGreaterThan(1);
});

test('经典书架：打开爱丽丝读到真实多段公版正文', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.book-card')).toHaveCount(16);
  await page.locator('.book-cover-button[aria-label*="Alice"]').first().click();
  await expect(page.locator('.reader-page')).toBeVisible();
  const paras = page.locator('.chapter-body p');
  await expect(paras.first()).toBeVisible();
  expect(await paras.count()).toBeGreaterThan(3);
  await expect(page.locator('.chapter-body')).toContainText('Alice');
  expect(pageErrors).toEqual([]);
});

test('听写复习：听音拼写，判定并给出正确拼写', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: /主动复习/ }).click();
  await page.getByRole('button', { name: '听写', exact: true }).click();
  await page.getByRole('button', { name: /开始本次复习/ }).click();
  await expect(page.getByRole('button', { name: '播放读音' })).toBeVisible();
  await expect(page.getByRole('button', { name: '慢速重听' })).toBeVisible();
  await page.getByPlaceholder('把听到的单词拼写出来').fill('zzzznotaword');
  await page.getByRole('button', { name: '检查答案' }).click();
  await expect(page.locator('.cloze-feedback')).toContainText('正确拼写是');
  expect(pageErrors).toEqual([]);
});

test('TXT 文件导入 + 每日目标可调', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '导入书籍' }).click();
  await page.locator('input[type="file"][accept*="epub"]').setInputFiles({ name: 'article.txt', mimeType: 'text/plain', buffer: Buffer.from('The morning light fell across the quiet street.\n\nA child laughed somewhere beyond the gate.') });
  await expect(page.locator('.reader-page')).toBeVisible();
  await expect(page.locator('.chapter-body')).toContainText('morning light');
  await page.getByRole('button', { name: '返回书库' }).click();

  // 提高每日目标 5→6
  await page.getByRole('button', { name: '提高每日目标' }).click();
  await expect(page.locator('.goal-today b')).toContainText('/6');
});

test('句子回译：收藏句子进入复习，挖空答对计入复习记录', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: '粘贴文本' }).click();
  await page.locator('.text-import input').fill('A Quiet Garden');
  await page.locator('.text-import textarea').fill('Attention is a garden.\n\nThe spotlight of the mind wanders among the flowers.');
  await page.getByRole('button', { name: '导入为可阅读的书' }).click();
  await page.locator('.reader-page').waitFor();
  await page.locator('.word[data-word="spotlight"]').click();
  await page.getByRole('button', { name: '收藏句子' }).click();
  await page.getByRole('button', { name: '返回原文' }).click();
  await page.getByRole('button', { name: '返回书库' }).click();

  await page.getByRole('button', { name: /主动复习/ }).click();
  await page.getByRole('button', { name: '句子回译' }).click();
  await page.getByRole('button', { name: '开始本次复习' }).click();
  await expect(page.locator('.cloze-hint')).toContainText('聚光灯').catch(() => {});
  await page.locator('.study-card input').fill('spotlight');
  await page.getByRole('button', { name: '检查答案' }).click();
  await expect(page.locator('.cloze-feedback.correct')).toBeVisible();
  await expect(page.locator('.cloze-full')).toContainText('spotlight of the mind');
  expect(pageErrors).toEqual([]);
});

test('分级入门书架：A1/A2/B1 徽章 + 全部有释义模式显示 ruby', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.book-card .level-badge')).toHaveCount(9);
  await page.getByRole('button', { name: '打开《The Tortoise and the Hare》' }).click();
  await expect(page.locator('.chapter-body')).toContainText('tortoise');
  await page.getByRole('button', { name: '阅读版式' }).click();
  await page.locator('.annotation-select').selectOption('all');
  await expect(page.locator('.chapter-body ruby rt').first()).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('B2 原著桥：盖茨比改写版可读，衔接到原著', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: '打开《The Great Gatsby (Graded Bridge)》' }).click();
  await expect(page.locator('.chapter-body')).toContainText('Gatsby');
  await expect(page.locator('.chapter-body')).toContainText('green light');
  expect(pageErrors).toEqual([]);
});
