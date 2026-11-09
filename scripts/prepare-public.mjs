/**
 * 生成并审计一份「可公开」的干净源码快照。
 *
 * 这是个**纯本地**脚本：只复制文件、扫描内容、打印报告。
 * 它不会 git add / commit / push，也不会修改任何远端或仓库可见性。
 *
 * 用法：npm run prepare:public
 *      PUBLIC_SNAPSHOT_DIR=/path/to/snapshot npm run prepare:public
 *
 * 为什么要单独做快照：本仓库的首个（也是唯一一个）commit 里含有第三方版权素材，
 * 直接从当前工作区 commit 并不能保证「没有误带文件」。这份快照用白名单 +
 * 禁用规则 + 正文关键词扫描，把「公开后别人到底能看到什么」变成可验证的事实。
 */

import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dest = process.env.PUBLIC_SNAPSHOT_DIR || '/tmp/linguaflow-reader-public';

/** 只复制这些目录 / 文件，其它一律不带。 */
const TREES = ['src', 'scripts', 'docs', 'public/licenses'];
const FILES = [
  '.gitignore', 'LICENSE', 'README.md', 'THIRD-PARTY-NOTICES.md',
  'index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts',
  'public/sw.js', 'public/manifest.webmanifest',
  'public/linguaflow-icon.png', 'public/linguaflow-logo.png',
];

/** 出现即判失败的路径（相对快照根，POSIX 分隔）。 */
const FORBIDDEN = [
  /^public\/books\//, /^public\/local-content\//, /^public\/wasm\//, /^public\/models\//,
  /^qa\//, /^dist\//, /^node_modules\//, /^\.workbuddy\//, /^\.git\//,
  /^\.env/, /\.tsbuildinfo$/,
  /wimpyKidBook\.ts$/, /wimpyKidAudioMap\.ts$/,
];

/** 唯一允许出现的二进制资源（项目自有品牌图标）。 */
const ALLOWED_BINARY = new Set([
  'public/linguaflow-icon.png', 'public/linguaflow-logo.png',
]);

/** 书籍正文的特征串（说明书里提到书名不算，这里只匹配正文级内容）。 */
const BODY_MARKERS = [
  'Greg Heffley', 'Rodrick woke me', 'Diary of a wimpy kid / Jeff Kinney',
  '"pageImages"', '"pageBlocks"',
];

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full, base));
    else out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });

for (const tree of TREES) {
  const source = join(root, tree);
  if (!existsSync(source)) { console.warn(`[warn] 缺少目录 ${tree}`); continue; }
  await cp(source, join(dest, tree), { recursive: true });
}
for (const file of FILES) {
  const source = join(root, file);
  if (!existsSync(source)) { console.warn(`[warn] 缺少文件 ${file}`); continue; }
  await mkdir(dirname(join(dest, file)), { recursive: true });
  await cp(source, join(dest, file));
}

// src/ 是整棵复制的，本机保留的两个书籍数据 TS 会跟着过来。
// .gitignore 只影响 git，不影响 cp —— 必须在快照层显式删掉。
for (const file of ['src/data/wimpyKidBook.ts', 'src/data/wimpyKidAudioMap.ts']) {
  await rm(join(dest, file), { force: true });
}

// 两个文件会「引用」特征串但不含正文：审计脚本自身的常量、以及把特征串列为
// 上线检查项的 runbook。其余文件照扫。
const SCAN_EXEMPT = new Set([
  'scripts/prepare-public.mjs',
  'docs/PREPARE-PUBLIC.md',
]);

const files = (await walk(dest)).sort();
const violations = [];

for (const file of files) {
  if (FORBIDDEN.some((rule) => rule.test(file))) violations.push(`禁用路径: ${file}`);
  if (/\.(png|jpe?g|webp|gif|mp3|m4a|aac|wav|ogg|flac|webm)$/i.test(file) && !ALLOWED_BINARY.has(file)) {
    violations.push(`未授权的二进制资源: ${file}`);
  }
}

for (const file of files.filter((item) => !SCAN_EXEMPT.has(item) && /\.(ts|tsx|js|mjs|json|md|css|html)$/.test(item))) {
  const text = await readFile(join(dest, file), 'utf8').catch(() => '');
  for (const marker of BODY_MARKERS) {
    if (text.includes(marker)) violations.push(`疑似书籍正文: ${file} → ${marker}`);
  }
}

let totalBytes = 0;
for (const file of files) totalBytes += (await stat(join(dest, file))).size;

const report = [
  '# 公开快照审计报告',
  '',
  // 不写生成时间：报告会随快照一起分发，时间戳会让每次同步都产生无意义 diff。
  `快照目录：${dest}`,
  `文件数：${files.length}`,
  `总大小：${(totalBytes / 1048576).toFixed(2)} MB`,
  '',
  `结论：${violations.length ? `❌ 发现 ${violations.length} 项问题` : '✅ 未发现版权素材或书籍正文'}`,
  '',
  `正文扫描豁免（仅引用特征串、不含正文）：${[...SCAN_EXEMPT].join('、')}`,
  '',
  ...(violations.length ? ['## 问题', '', ...violations.map((item) => `- ${item}`), ''] : []),
  '## 文件清单',
  '',
  ...files.map((file) => `- \`${file}\``),
  '',
].join('\n');

await writeFile(join(dest, 'PUBLIC-SNAPSHOT-REPORT.md'), report);
console.log(`[prepare-public] 快照 → ${dest}`);
console.log(`[prepare-public] 文件 ${files.length} 个 / ${(totalBytes / 1048576).toFixed(2)} MB`);
console.log(`[prepare-public] ${violations.length ? `❌ ${violations.length} 项问题：\n${violations.join('\n')}` : '✅ 未发现版权素材、书籍正文或未授权二进制'}`);
console.log('[prepare-public] 本脚本未执行任何 git / 远端操作。');
process.exitCode = violations.length ? 1 : 0;
