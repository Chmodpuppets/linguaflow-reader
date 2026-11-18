import { test, expect } from './base';

// 用户自带 Qwen TTS：设置卡片两种接入协议、密钥本地持久化、试听直连用户端点。
const goSettings = async (page: import('@playwright/test').Page) => {
  await page.locator('.main-nav .nav-item', { hasText: '阅读设置' }).click();
  await expect(page.locator('.settings-page')).toBeVisible();
};

test('TTS 设置：两种协议切换、填 Key 启用兜底、刷新后持久化', async ({ page }) => {
  await page.goto('/');
  await goSettings(page);
  const card = page.locator('.tts-card');
  await expect(card).toBeVisible();
  // 默认关闭：无配置字段
  await expect(card.locator('.tts-fields')).toHaveCount(0);

  // 切到阿里云百炼：出现 DashScope API Key 字段，未填 Key 提示仍用浏览器 TTS
  await card.locator('.segmented button', { hasText: '阿里云百炼' }).click();
  const keyField = card.locator('.tts-field', { hasText: 'DashScope API Key' }).locator('input');
  await expect(keyField).toBeVisible();
  await expect(card.locator('.tts-status')).toContainText('未填 API Key');

  // 填 Key → 已启用兜底
  await keyField.fill('sk-e2e-test-key');
  await expect(card.locator('.tts-status')).toContainText('已启用兜底');

  // 等防抖写盘落定（设置改动 400ms 防抖批量写）再刷新，验证持久化
  await page.waitForTimeout(700);
  await page.reload();
  await goSettings(page);
  const card2 = page.locator('.tts-card');
  await expect(card2.locator('.tts-status')).toContainText('已启用兜底');
  await expect(card2.locator('.tts-field', { hasText: 'DashScope API Key' }).locator('input')).toHaveValue('sk-e2e-test-key');

  // 切到 OpenAI 兼容：出现 Base URL 字段
  await card2.locator('.segmented button', { hasText: 'OpenAI 兼容' }).click();
  await expect(card2.locator('.tts-field', { hasText: 'Base URL' })).toBeVisible();
});

test('TTS 试听：直连用户填写的 DashScope 端点并按协议组包', async ({ page }) => {
  await page.goto('/');
  let captured: any = null;
  await page.route('**/api/v1/services/aigc/multimodal-generation/generation', async (route) => {
    captured = JSON.parse(route.request().postData() ?? '{}');
    // 返回 base64 音频（试听只需拿到非空 URL 即报成功，播放失败被静默吞掉）
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: { audio: { data: 'UklGRg==' } } }) });
  });

  await goSettings(page);
  const card = page.locator('.tts-card');
  await card.locator('.segmented button', { hasText: '阿里云百炼' }).click();
  await card.locator('.tts-field', { hasText: 'DashScope API Key' }).locator('input').fill('sk-e2e-test-key');
  await card.locator('button', { hasText: '试听' }).click();

  await expect(page.locator('.toast', { hasText: '试听成功' })).toBeVisible();
  expect(captured).not.toBeNull();
  expect(captured?.model).toBe('qwen3-tts-flash');
  expect(captured?.input?.voice).toBe('Cherry');
  expect(captured?.input?.text).toContain('voice preview');
});

test('TTS 缓存管理：试听后本机缓存计数增长，清空归零', async ({ page }) => {
  await page.goto('/');
  await page.route('**/api/v1/services/aigc/multimodal-generation/generation', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: { audio: { data: 'UklGRg==' } } }) });
  });
  await goSettings(page);
  const card = page.locator('.tts-card');
  const stat = card.locator('.tts-cache-stat');
  const clearBtn = card.locator('.tts-cache button', { hasText: '清空缓存' });

  // 初始无缓存：0 段，清空按钮禁用
  await expect(stat).toContainText('本机缓存');
  await expect(stat).toContainText('0 段');
  await expect(clearBtn).toBeDisabled();

  // 配置 + 试听 → 合成结果落本机缓存，计数增至 1 段
  await card.locator('.segmented button', { hasText: '阿里云百炼' }).click();
  await card.locator('.tts-field', { hasText: 'DashScope API Key' }).locator('input').fill('sk-e2e-test-key');
  await card.locator('button', { hasText: '试听' }).click();
  await expect(page.locator('.toast', { hasText: '试听成功' })).toBeVisible();
  await expect(stat).toContainText('1 段');
  await expect(clearBtn).toBeEnabled();

  // 清空 → 归零、按钮重新禁用
  await clearBtn.click();
  await expect(page.locator('.toast', { hasText: '已清空本机发音缓存' })).toBeVisible();
  await expect(stat).toContainText('0 段');
  await expect(clearBtn).toBeDisabled();
});
