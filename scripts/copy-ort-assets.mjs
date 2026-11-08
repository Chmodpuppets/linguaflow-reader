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
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const target = join(root, 'public', 'wasm');

const FILES = ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];

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
    console.warn(`wasm: 复制 ${file} 失败 -> ${error.message}（Whisper 会退回浏览器原生识别）`);
  }
}
