import { test, expect } from './base';

// Word Atlas（词光）CC BY 词库增强查词面板。
// 文本数据（index/entries）与媒体（插画）全部 mock，避免依赖外网/真实镜像，确定性验证。
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const ATLAS_INDEX = {
  chunk: 100, count: 2,
  cefr: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
  topics: [['animals', '动物'], ['travel', '旅行']],
  words: [
    ['w1', 'curious', 'adj. 好奇的', 'ˈkjʊəriəs', 1, 0, 31],
    ['w2', 'wander', 'v. 漫步', 'ˈwɒndə', 2, 1, 15],
  ],
};
const ATLAS_BLOCK0 = [
  {
    w: 'curious', uk: 'ˈkjʊəriəs', us: 'ˈkjʊriəs',
    senses: [{ pos: 'adj.', zh: '好奇的', en: 'eager to know or learn' }],
    ex: [{ en: 'The curious fox looked around.', zh: '好奇的狐狸四处张望。' }, { en: 'She was curious about the world.', zh: '她对世界充满好奇。' }],
    col: ['curious about'], fam: ['curiosity', 'curiously'], syn: ['inquisitive'], ant: ['indifferent'],
    tip: '对事物充满想知道的欲望。', cefr: 'A2', topic: 'animals',
  },
  {
    w: 'wander', uk: 'ˈwɒndə', us: 'ˈwɑːndər',
    senses: [{ pos: 'v.', zh: '漫步', en: 'to walk slowly without a clear direction' }],
    ex: [{ en: 'We wandered through the old town.', zh: '我们在老城漫步。' }],
    col: ['wander around'], fam: ['wanderer'], syn: ['roam'], ant: ['stay'],
    tip: '没有目的地慢慢走。', cefr: 'B1', topic: 'travel',
  },
];

async function mockAtlas(page: import('@playwright/test').Page) {
  await page.route('**/atlas/index.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(ATLAS_INDEX) }));
  await page.route('**/atlas/entries/0.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(ATLAS_BLOCK0) }));
  // 插画/缩略图走源站 CDN：mock 成同源小图，避免外网失败导致降级。
  await page.route('**/atlas/thumb/**', (route) => route.fulfill({ contentType: 'image/png', body: TINY_PNG }));
  await page.route('**/atlas/img/**', (route) => route.fulfill({ contentType: 'image/png', body: TINY_PNG }));
}

async function importBook(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '粘贴文本' }).click();
  await page.locator('.text-import input').fill('Atlas Fixture');
  await page.locator('.text-import textarea').fill('The curious fox likes to wander.\n\nIt watches the quiet garden.');
  await page.getByRole('button', { name: '导入为可阅读的书' }).click();
  await expect(page.locator('.reader-page')).toBeVisible();
}

test('Word Atlas 增强：有在线词典时基础释义不变，下方追加富词条卡（CEFR/插画/例句/署名）', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await mockAtlas(page);
  // 服务器英汉词典命中 curious → 基础面板仍走 SERVER，atlas 作增强叠加。
  await page.route('**/api/dict/lookup*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ found: true, lang: 'en', word: 'curious', phonetic: 'ˈkjʊəriəs', meaning: 'a. 好奇的，求知的', pos: 'a' }),
  }));
  await importBook(page);

  await page.locator('.chapter-body .word[data-word="curious"]').click();
  const panel = page.locator('.lookup-panel');
  await expect(panel).toBeVisible();
  // 基础面板来源/释义不变（不被 atlas 替换）。
  await expect(panel.locator('.eyebrow')).toHaveText('SERVER DICTIONARY · 英汉');
  await expect(panel.locator('.dictionary-meaning')).toContainText('好奇的');
  // 富词条增强卡。
  const card = panel.locator('.atlas-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.atlas-cefr')).toHaveText('A2');
  await expect(card.locator('.atlas-topic')).toHaveText('动物');
  await expect(card.locator('.atlas-img')).toBeVisible();
  await expect(card.locator('.atlas-pron-btn')).toHaveCount(2); // UK + US
  await expect(card.locator('.atlas-example-en').first()).toContainText('curious fox');
  await expect(card.locator('.atlas-chips').first()).toContainText('curious about');
  await expect(card.locator('.atlas-tip')).toContainText('想知道');
  await expect(card.locator('.atlas-credit')).toContainText('Word Atlas');
  expect(pageErrors).toEqual([]);
});

test('Word Atlas 兜底：在线词典都不可达时，词库直接作为释义来源（WORD ATLAS · 词光）', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await mockAtlas(page);
  // 服务器 + Free Dictionary 均不可达 → 无 remote，atlas 成为基础释义。
  await page.route('**/api/dict/lookup*', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"found":false}' }));
  await page.route('**/api.dictionaryapi.dev/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  await importBook(page);

  await page.locator('.chapter-body .word[data-word="wander"]').click();
  const panel = page.locator('.lookup-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.eyebrow')).toHaveText('WORD ATLAS · 词光');
  await expect(panel.locator('.dictionary-meaning')).toContainText('walk slowly');
  await expect(panel.locator('.dictionary-cn')).toContainText('漫步');
  await expect(panel.locator('.atlas-card')).toBeVisible();
  await expect(panel.locator('.atlas-card .atlas-cefr')).toHaveText('B1');
  expect(pageErrors).toEqual([]);
});
