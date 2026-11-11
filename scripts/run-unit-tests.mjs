#!/usr/bin/env node
/**
 * 单元测试运行器：用项目已有的 esbuild 把 tests/unit/*.test.ts 连同被测源码
 * 打包成 ESM，再交给 Node 内置 test runner 执行。零新依赖。
 *
 * 用法：npm run test:unit
 */
import { build } from 'esbuild';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const testDir = join(root, 'tests', 'unit');
const outDir = join(root, 'node_modules', '.cache', 'lfr-unit');

await mkdir(outDir, { recursive: true });
const files = (await readdir(testDir)).filter((file) => file.endsWith('.test.ts')).sort();
if (!files.length) {
  console.error('tests/unit 下没有 *.test.ts');
  process.exit(1);
}

const outFiles = [];
for (const file of files) {
  const outfile = join(outDir, file.replace(/\.ts$/, '.mjs'));
  await build({
    entryPoints: [join(testDir, file)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'silent',
    // whisper.worker 里的 new URL(...) 只在被 tree-shake 掉的函数中出现；
    // 万一残留，把 transformers 标为 external 避免把整个推理库打进测试包。
    external: ['@huggingface/transformers'],
  });
  outFiles.push(outfile);
}

const result = spawnSync(process.execPath, ['--test', ...outFiles], { stdio: 'inherit' });
process.exit(result.status ?? 1);
