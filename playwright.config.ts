import { defineConfig, devices } from '@playwright/test';

/**
 * E2E 跑在 **生产构建** 上（vite preview），不是 dev：
 * Service Worker 只在 `import.meta.env.PROD` 下注册，离线 / 预缓存用例必须在 preview 才有意义。
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // CI 同时产出 HTML 报告，失败时随 artifact 上传，便于定位 selector / 时序问题。
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3012',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://127.0.0.1:3012',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
