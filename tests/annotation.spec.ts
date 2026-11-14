import { test, expect } from '@playwright/test';

// 常驻注音 + 词状态：标记学习中→原文出现 ruby；标记已掌握→注音移除（逐渐裸页）。
test('词状态驱动常驻注音：学习中显示、已掌握移除，覆盖率随之变化', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');

  await page.locator('.book-card').first().getByRole('button', { name: '继续阅读' }).click();
  await expect(page.locator('.reader-page')).toBeVisible();
  await expect(page.locator('.chapter-body p').first()).toBeVisible();

  const word = page.locator('.word[data-word="Attention"]');
  await expect(word).toBeVisible();
  // 初始未标记：不注音
  await expect(word.locator('ruby')).toHaveCount(0);

  // 打开查词面板，标为学习中 → 原文出现常驻注音
  await word.click();
  await expect(page.locator('.lookup-panel')).toBeVisible();
  await page.locator('.state-btn.learning').click();
  await expect(word.locator('ruby rt')).toHaveCount(1);
  await expect(word.locator('ruby rt')).not.toHaveText('');
  await expect(page.locator('.stat-chip.learning')).toContainText('学习中 1');

  // 标为已掌握 → 注音移除
  await page.locator('.state-btn.known').click();
  await expect(word.locator('ruby')).toHaveCount(0);
  await expect(page.locator('.stat-chip.known')).toContainText('已掌握 1');

  // 关闭面板后注音状态保持（已掌握不注音）
  await page.getByRole('button', { name: '返回原文' }).click();
  await expect(word.locator('ruby')).toHaveCount(0);

  expect(pageErrors).toEqual([]);
});

test('冷启动：新用户打开入门 A1 书即见预置常驻注音（核心价值首次交互可感知）', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await page.locator('.recommend-card.cold-start').getByRole('button', { name: '开始阅读' }).click();
  await expect(page.locator('.reader-page')).toBeVisible();
  // 预置「学习中」词直接渲染 ruby，无需先查词标记
  await expect(page.locator('.chapter-body ruby rt').first()).toBeVisible();
  expect(await page.locator('.chapter-body ruby rt').count()).toBeGreaterThan(0);
  await expect(page.locator('.stat-chip.learning')).toContainText('学习中 5');
  expect(pageErrors).toEqual([]);
});

test('版式面板可切换常驻注音模式（off 关闭 / all 全注）', async ({ page }) => {
  await page.goto('/');
  await page.locator('.book-card').first().getByRole('button', { name: '继续阅读' }).click();
  await expect(page.locator('.reader-page')).toBeVisible();

  const word = page.locator('.word[data-word="Attention"]');
  await word.click();
  await page.locator('.state-btn.learning').click();
  await expect(word.locator('ruby rt')).toHaveCount(1);
  await page.getByRole('button', { name: '返回原文' }).click();

  // 打开版式面板，切到 off → 注音消失
  await page.getByRole('button', { name: '阅读版式' }).click();
  await page.locator('.annotation-select').selectOption('off');
  await expect(word.locator('ruby')).toHaveCount(0);
  // 切到 all → 有释义的词都注音（attention 已学习中，仍注）
  await page.locator('.annotation-select').selectOption('all');
  await expect(word.locator('ruby rt')).toHaveCount(1);
});
