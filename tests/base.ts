import { test as base, expect } from '@playwright/test';

// 生产默认空书架（用户自导入 EPUB）；E2E 需要内置书作为夹具，
// 故在每个页面加载前置开关，恢复样书/分级/经典与种子数据。
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      (window as unknown as { __LF_BUILTIN_SHELF__?: string }).__LF_BUILTIN_SHELF__ = '1';
    });
    await use(page);
  },
});
export { expect };
