/**
 * 把本机内置书籍数据（226 页 OCR 全文 + 有声书句级时间戳）导出成本机 JSON。
 *
 * 这些是第三方版权作品的衍生文本，**绝不随开源仓库分发**：
 *   - 源 TS 文件只存在于本机（src/data/*.ts，已加入 .gitignore）
 *   - 产物 public/local-content/*.json 同样被 gitignore 排除，build 时由
 *     vite.config.ts 的 dropLocalBookAssets() 从 dist 剔除
 *
 * 用法：npm run export:local-content
 * 新 clone 没有源 TS 文件时本脚本安静跳过；应用会优雅降级为只有轻量样书，这是预期行为。
 */
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = join(root, 'public', 'local-content');
const tmpDir = join(root, 'node_modules', '.cache', 'lfr-export');

async function loadDataModule(file, symbol) {
  const source = join(root, 'src', 'data', file);
  if (!existsSync(source)) throw new Error(`缺少本机源文件 src/data/${file}`);
  await mkdir(tmpDir, { recursive: true });
  const outfile = join(tmpDir, `${file.replace(/\W/g, '_')}.mjs`);
  // esbuild 会直接擦掉 `import type`，不需要 TS 类型解析，也不依赖 tsconfig。
  await build({ entryPoints: [source], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' });
  const mod = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
  if (!mod[symbol]) throw new Error(`${file} 未导出 ${symbol}`);
  return mod[symbol];
}

try {
  const book = await loadDataModule('wimpyKidBook.ts', 'wimpyKidBook');
  const map = await loadDataModule('wimpyKidAudioMap.ts', 'wimpyKidAudioMap');
  if (!Array.isArray(book?.chapters) || !Array.isArray(map)) throw new Error('本机数据格式不符合预期');
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'wimpy-kid.json'), JSON.stringify(book));
  await writeFile(join(outDir, 'wimpy-kid-audio-map.json'), JSON.stringify(map));
  console.log(`[export-local-content] 已导出 ${book.chapters.length} 页正文 / ${map.length} 行时间戳 → public/local-content/`);
  console.log('[export-local-content] 仅本机可用，两个 JSON 与源 TS 都不入库、不进公开构建产物。');
} catch (error) {
  console.warn(`[export-local-content] 跳过：${error instanceof Error ? error.message : String(error)}`);
  console.warn('[export-local-content] 没有本机书籍数据时应用会降级为轻量样书，这是预期行为。');
} finally {
  await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
}
