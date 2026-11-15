import { test, expect } from './base';

// 音频一键建课 UI：导入弹窗新增「音频建课」tab；选音频后建课按钮可用。
// 完整转写依赖本地 Whisper 模型（headless 下载/推理不稳定），算法由 lessonBuilder 单测覆盖，
// 转写链路复用已验证的 bookAlignment 基础设施，这里只做 UI 冒烟。

// 最小合法 WAV（44 字节头 + 少量静音样本），仅用于触发文件选择，不做真实转写。
function tinyWav(): Buffer {
  const samples = 1600; // 0.1s @16kHz
  const dataSize = samples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(16000, 24); buf.writeUInt32LE(32000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
  return buf;
}

test('导入弹窗「音频建课」tab 渲染建课工具，未选音频时按钮禁用', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: '音频建课' }).first().click();
  await expect(page.locator('.lesson-builder')).toBeVisible();
  await expect(page.locator('.lesson-intro')).toContainText('把一段音频变成可跟读的课程');
  await expect(page.locator('.lesson-audio')).toContainText('选择音频文件');
  await expect(page.locator('.lesson-builder select')).toBeVisible();
  await expect(page.getByRole('button', { name: /一键建课/ })).toBeDisabled();
  expect(pageErrors).toEqual([]);
});

test('选择音频文件后显示文件名并启用建课按钮', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: '音频建课' }).first().click();
  await expect(page.locator('.lesson-builder')).toBeVisible();
  await page.locator('.lesson-audio input[type="file"]').setInputFiles({ name: 'my-talk.wav', mimeType: 'audio/wav', buffer: tinyWav() });
  await expect(page.locator('.lesson-audio-meta strong')).toHaveText('my-talk.wav');
  await expect(page.getByRole('button', { name: /一键建课/ })).toBeEnabled();
  // 标题自动取自文件名（.field 里的标题输入框，排除隐藏的音频 file input）
  await expect(page.locator('.lesson-builder .field input').first()).toHaveValue('my-talk');
  expect(pageErrors).toEqual([]);
});
