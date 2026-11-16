import { test, expect } from './base';

// 课程播放列表：创建 → 书卡加入 → 管理曲目 → 连续播放器渲染，全部 live。
test('播放列表：创建、加入书籍、管理曲目、打开连续播放器', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await page.locator('.book-card').first().waitFor();
  const firstTitle = await page.locator('.book-card').first().locator('h3').innerText();

  // 创建播放列表
  await page.locator('.playlists-button').click();
  await page.getByLabel('播放列表名称').fill('睡前听力');
  await page.getByRole('button', { name: /创建播放列表/ }).click();
  await expect(page.locator('.playlist-list li', { hasText: '睡前听力' })).toBeVisible();
  await page.keyboard.press('Escape');

  // 书卡「加入播放列表」→ 选择已有列表
  await page.locator('.book-card').first().locator('[aria-label*="加入播放列表"]').click();
  await page.locator('.playlist-chooser .view-apply', { hasText: '睡前听力' }).click();

  // 重新打开管理弹窗 → 进入该列表详情 → 见到曲目
  await page.locator('.playlists-button').click();
  await page.locator('.playlist-list .view-apply', { hasText: '睡前听力' }).click();
  await expect(page.locator('.playlist-tracks li')).toHaveCount(1);
  await expect(page.locator('.playlist-tracks .track-title')).toHaveText(firstTitle);

  // 打开连续播放器
  await page.getByRole('button', { name: /连续播放/ }).click();
  await expect(page.locator('.playlist-player')).toBeVisible();
  await expect(page.locator('.player-track')).toHaveCount(1);
  await expect(page.locator('.player-title')).toHaveText(firstTitle);
  await expect(page.getByRole('button', { name: '下一首' })).toBeDisabled();
  expect(pageErrors).toEqual([]);
});

test('播放列表：书卡选择器「创建并加入」一步建列表并收书', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await page.locator('.book-card').first().waitFor();

  await page.locator('.book-card').first().locator('[aria-label*="加入播放列表"]').click();
  await page.getByLabel('新建播放列表名称').fill('本周课程');
  await page.getByRole('button', { name: /创建并加入/ }).click();

  // 列表已创建且含 1 首
  await page.locator('.playlists-button').click();
  await expect(page.locator('.playlist-list li', { hasText: '本周课程' })).toContainText('1 首');
  expect(pageErrors).toEqual([]);
});
