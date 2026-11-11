#!/usr/bin/env node
/**
 * 把 onnxruntime-web 的 wasm 运行时复制到 public/wasm/。
 *
 * 为什么需要这一步：transformers.js 默认从 jsDelivr 拉 ORT 的 wasm/mjs，
 * 而深圳直连 jsDelivr 会 SSL 失败（实测 000）。自托管后 Whisper 才能在本地跑通，
 * 而且配合 Service Worker 可以完全离线。
 *
 * 只在 dev/build 前执行，14MB 的 wasm 不进 git。
 */
import { copyFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const target = join(root, 'public', 'wasm');

// wasm 文件名与 ORT 版本强相关。package.json 用 overrides 把 onnxruntime-web 显式锁在
// 下面这个 dev 版（transformers 也精确依赖它）；升级 ORT 前必须先核对 FILES 是否仍匹配，
// 否则自托管 wasm 会静默缺失、Whisper 退回浏览器原生识别。
const FILES = ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];

const ortVersion = await readFile(join(root, 'node_modules', 'onnxruntime-web', 'package.json'), 'utf8')
  .then((text) => JSON.parse(text).version)
  .catch(() => 'unknown');
console.log(`wasm: onnxruntime-web ${ortVersion}`);

await mkdir(target, { recursive: true });

for (const file of FILES) {
  const from = join(source, file);
  const to = join(target, file);
  try {
    const [a, b] = await Promise.all([stat(from), stat(to).catch(() => null)]);
    if (b && b.size === a.size && b.mtimeMs >= a.mtimeMs) { console.log(`wasm: ${file} 已是最新，跳过`); continue; }
    await copyFile(from, to);
    console.log(`wasm: 已复制 ${file} (${(a.size / 1048576).toFixed(1)}MB)`);
  } catch (error) {
    // 升级 ORT 后文件名可能改名/增删变体：列出该版本实际包含的 wasm，便于核对 FILES。
    const available = await readdir(source).catch(() => []);
    console.warn(`wasm: 复制 ${file} 失败 -> ${error.message}（ORT ${ortVersion}；Whisper 会退回浏览器原生识别）`);
    console.warn(`wasm: 该版本 dist 实际包含的 wasm: ${available.filter((f) => f.endsWith('.wasm')).join(', ') || '无'}`);
  }
}
