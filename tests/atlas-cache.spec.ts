import { test, expect } from './base';

// 词库真人录音（跨域 OSS，无 CORS）经 Service Worker 进独立有界缓存 atlas-audio-v1：
// 在线发音后缓存 opaque 整段；离线时媒体元素仍能从缓存 loadeddata（真人录音离线可播）。
// SW 只在生产构建注册，故本用例依赖 webServer 的 preview。
const RECORDING = 'https://pathmora.oss-cn-beijing.aliyuncs.com/atlas/v1/audio/us/library.mp3';

test('词库真人录音进 SW 缓存且离线可播', async ({ page, context }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 20000 });

  // 触发一次媒体加载（经过 SW fetch）；play 确保 headless 下真正发起请求。
  await page.evaluate((u) => { const a = new Audio(u); a.preload = 'auto'; a.load(); a.play().catch(() => {}); }, RECORDING);

  // 轮询直到缓存写入 opaque 整段。
  await expect
    .poll(
      () =>
        page.evaluate(async (u) => {
          const m = await (await caches.open('atlas-audio-v1')).match(u);
          return m ? m.type : null;
        }, RECORDING),
      { timeout: 15000 },
    )
    .toBe('opaque');

  // 离线复播：SW 从缓存供给，媒体能 loadeddata（不依赖 play 自动播放许可）。
  await context.setOffline(true);
  const offlineLoaded = await page.evaluate(
    (u) =>
      new Promise<boolean>((resolve) => {
        const a = new Audio(u);
        a.preload = 'auto';
        const timer = setTimeout(() => resolve(false), 8000);
        a.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(true); });
        a.addEventListener('error', () => { clearTimeout(timer); resolve(false); });
        a.load();
        a.play().catch(() => {});
      }),
    RECORDING,
  );
  await context.setOffline(false);
  expect(offlineLoaded).toBe(true);
});
