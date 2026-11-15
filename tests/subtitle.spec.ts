import { test, expect } from './base';

// 字幕一键建课全流程：选 .srt → 精确时间轴秒建课程（无需 Whisper）→ 打开可阅读、书库见「字幕建课」标签。
const SRT = [
  '1', '00:00:01,000 --> 00:00:04,000', 'The curious cat sat on the warm mat.', '',
  '2', '00:00:05,000 --> 00:00:08,000', 'She watched the birds outside the window.', '',
  '3', '00:00:09,000 --> 00:00:12,000', 'It was a quiet and peaceful afternoon.', '',
  '4', '00:00:13,000 --> 00:00:16,000', 'Soon the sun began to set behind the hills.', '',
].join('\n');

test('选择 SRT 字幕：显示句数、隐藏识别模型、一键建课打开课程', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: '音频/字幕建课' }).first().click();
  await expect(page.locator('.lesson-builder')).toBeVisible();

  await page.locator('.lesson-subtitle input[type="file"]').setInputFiles({ name: 'cat-story.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(SRT, 'utf8') });
  await expect(page.locator('.lesson-subtitle .lesson-audio-meta')).toContainText('4 句');
  // 有字幕时不需要语音识别：模型选择与文稿输入隐藏
  await expect(page.locator('.lesson-builder select')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /一键建课/ })).toBeEnabled();
  await expect(page.locator('.lesson-builder .field input').first()).toHaveValue('cat-story');

  await page.getByRole('button', { name: /一键建课/ }).click();
  // 建课后自动打开课程
  await expect(page.locator('.reader-page')).toBeVisible();
  await expect(page.locator('.chapter-body')).toContainText('curious cat');
  await expect(page.locator('.chapter-body')).toContainText('sun began to set');
  // 4 句按 3 句/段合并 → 至少 2 个自然段
  expect(await page.locator('.chapter-body p').count()).toBeGreaterThanOrEqual(2);

  // 回书库：课程在架，带「字幕建课」标签
  await page.getByRole('button', { name: '返回书库' }).click();
  const card = page.locator('.book-card', { hasText: 'cat-story' });
  await expect(card).toHaveCount(1);
  await expect(card.locator('.book-tag', { hasText: '字幕建课' })).toHaveCount(1);
  expect(pageErrors).toEqual([]);
});

test('VTT 字幕同样可建课（点号毫秒 + 内联标签清洗）', async ({ page }) => {
  const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<i>Hello</i> &amp; welcome to the show.\n\n00:00:05.000 --> 00:00:08.000\nToday we talk about learning.\n';
  await page.goto('/');
  await page.getByRole('button', { name: '音频/字幕建课' }).first().click();
  await page.locator('.lesson-subtitle input[type="file"]').setInputFiles({ name: 'show.vtt', mimeType: 'text/vtt', buffer: Buffer.from(VTT, 'utf8') });
  await expect(page.locator('.lesson-subtitle .lesson-audio-meta')).toContainText('2 句');
  await page.getByRole('button', { name: /一键建课/ }).click();
  await expect(page.locator('.reader-page')).toBeVisible();
  await expect(page.locator('.chapter-body')).toContainText('Hello & welcome to the show.');
  await expect(page.locator('.chapter-body')).toContainText('Today we talk about learning.');
});
