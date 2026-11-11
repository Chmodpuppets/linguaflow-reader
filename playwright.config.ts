import { defineConfig, devices } from '@playwright/test';

/**
 * E2E 跑在 **生产构建** 上（vite preview），不是 dev：
 * Service Worker 只在 `import.meta.env.PROD` 下注册，离线 / 预缓存用例必须在 preview 才有意义。
 *
 * 端口与 dev（3012）隔离：此前同用 3012 + reuseExistingServer，开发者开着 `npm run dev`
 * 跑测试会复用 dev server —— SW 不注册，offline 用例的 serviceWorker.ready 永不 resolve。
 */
const E2E_PORT = 4173;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // CI 同时产出 HTML 报告，失败时随 artifact 上传，便于定位 selector / 时序问题。
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec\.ts/ },
    // 移动视口单独跑 mobile.spec：覆盖底部导航 / 抽屉 / 阅读器在窄屏的布局与溢出。
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: `npm run build && npx vite preview --host 127.0.0.1 --port ${E2E_PORT} --strictPort`,
    url: `http://127.0.0.1:${E2E_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
