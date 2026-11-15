#!/usr/bin/env node
/**
 * 把 pdf.js 的标准字体数据与 CMap 复制到 public/pdfjs/。
 *
 * 为什么需要这一步：pdf.js 解析使用「标准 14 字体」（Helvetica 等）的 PDF 时，
 * 需要 standardFontDataUrl 提供字形数据；中文等 CID 字体需要 cMapUrl。
 * 自托管后 PDF 文字提取才能离线跑通，不依赖 CDN。只在 dev/build 前执行，不进 git。
 */
import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', 'pdfjs-dist');
const target = join(root, 'public', 'pdfjs');

await mkdir(target, { recursive: true });
for (const dir of ['standard_fonts', 'cmaps']) {
  await cp(join(source, dir), join(target, dir), { recursive: true });
  console.log(`pdf: 已复制 ${dir}/`);
}
