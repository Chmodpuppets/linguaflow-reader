import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * onnxruntime-web 内部用 `new URL('ort-wasm-*.wasm', import.meta.url)` 引用自己的 wasm，
 * Vite 会把这些文件当 asset 一起产出（光 asyncify 版就 27MB）。
 * 运行时我们通过 env.backends.onnx.wasm.wasmPaths 指向自托管的 /wasm/ 文件，
 * 这些产物永远不会被请求，所以打包后直接丢弃，避免 dist 白白肿一倍。
 */
function dropOrtWasmAssets(): Plugin {
  return {
    name: 'drop-ort-wasm-assets',
    generateBundle(_options, bundle) {
      for (const key of Object.keys(bundle)) {
        if (/ort-wasm.*\.wasm$/.test(key)) delete bundle[key];
      }
    },
  };
}

const BOOK_ASSET = /\.(png|jpe?g|webp|gif|mp3|m4a|aac|wav|ogg|oga|flac|webm)$/i;

/**
 * 公开部署产物不能携带本机版权素材（内置扫描书的页面图 + 有声书音频）。
 *
 * 这些文件留在 public/books/ 只为方便本机 dev（Vite dev server 直读 publicDir），
 * 但 Vite build 会把 publicDir 原样复制进 outDir —— 不做处理的话，一次部署就等于公开分发
 * 受版权保护的书籍扫描页与正文。因此在构建收尾时剔除 dist/books/<book>/ 下的图片音频，
 * 以及 dist/local-content/ 下由本机导出的书籍全文 / 时间戳 JSON。
 *
 * 本机构建想保留这些文件（例如离线自用时）设 KEEP_LOCAL_ASSETS=1。
 */
function dropLocalBookAssets(): Plugin {
  let outDir = resolve(process.cwd(), 'dist');
  return {
    name: 'drop-local-book-assets',
    apply: 'build',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    async closeBundle() {
      if (process.env.KEEP_LOCAL_ASSETS === '1') return;
      const booksDir = join(outDir, 'books');
      const dirs = await readdir(booksDir, { withFileTypes: true }).catch(() => []);
      let removed = 0;
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        const files = await readdir(join(booksDir, dir.name)).catch(() => [] as string[]);
        for (const file of files) {
          if (!BOOK_ASSET.test(file)) continue;
          await rm(join(booksDir, dir.name, file), { force: true });
          removed += 1;
        }
      }
      // 书籍正文的衍生数据（226 页 OCR 全文 + 3161 行句级时间戳）同样不能进公开产物。
      const localContentDir = join(outDir, 'local-content');
      const jsonFiles = await readdir(localContentDir).catch(() => [] as string[]);
      for (const file of jsonFiles) {
        if (!file.endsWith('.json')) continue;
        await rm(join(localContentDir, file), { force: true });
        removed += 1;
      }
      if (removed) console.log(`[drop-local-book-assets] 已从 dist 剔除 ${removed} 个本机版权素材（KEEP_LOCAL_ASSETS=1 可保留）`);
    },
  };
}

/**
 * 生成 Service Worker 的预缓存清单。
 *
 * 只解析 index.html 的 SW 只能预缓存 4 个入口 assets；React.lazy 的 chunk
 * （Reader / VoiceLab / VoiceRecorder / whisper.worker / epub / icons …）不在 HTML 里，
 * 离线首次打开这些页面会全部落到 503。这里在构建期把真实产出的 assets 列成 JSON，
 * SW install 时并发预缓存，离线首启才真正可用。
 *
 * 注册顺序有讲究：放在 dropOrtWasmAssets 之后，清单不会包含已被丢弃的 ORT wasm；
 * 写在 closeBundle（publicDir 复制完成、版权素材剔除之后），避免清单指向不存在的文件。
 */
function precacheManifest(): Plugin {
  let outDir = resolve(process.cwd(), 'dist');
  let assets: string[] = [];
  return {
    name: 'precache-manifest',
    apply: 'build',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    generateBundle(_options, bundle) {
      assets = Object.keys(bundle)
        .filter((key) => !key.endsWith('.map'))
        .map((key) => `/${key}`)
        .sort();
    },
    async closeBundle() {
      await writeFile(join(outDir, 'precache-manifest.json'), `${JSON.stringify({ version: Date.now(), assets }, null, 2)}\n`);
      // 把生产 SW 的缓存名绑定到构建产物：资源一变，sw.js 字节就变，
      // 浏览器自动触发 install + activate 清旧缓存。不再需要每次手工 bump 版本号
      // （漏一次用户就会一直拿引用旧 hash 的 index.html）。
      const swPath = join(outDir, 'sw.js');
      const source = await readFile(swPath, 'utf8').catch(() => null);
      if (source) {
        const stamp = createHash('sha1').update(assets.join('|')).digest('hex').slice(0, 10);
        const rewritten = source.replace(/const CACHE = 'linguaflow-reader-[^']+';/, `const CACHE = 'linguaflow-reader-${stamp}';`);
        if (rewritten !== source) await writeFile(swPath, rewritten);
      }
    },
  };
}

export default defineConfig({
  plugins: [dropOrtWasmAssets(), dropLocalBookAssets(), precacheManifest(), react()],
  server: { host: '127.0.0.1', port: 3012 },
  build: {
    rollupOptions: {
      output: {
        // 用函数形式精确归组：对象形式会把 react-dom 的依赖 scheduler 漏给 icons，
        // 造成 react chunk 反向依赖 icons。这里把整个 react 生态（含 scheduler）收进 react。
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('lucide-react')) return 'icons';
          if (id.includes('jszip')) return 'epub';
          if (id.includes('react-dom') || id.includes('scheduler') || id.includes('/react/')) return 'react';
          return undefined;
        },
      },
    },
  },
});
