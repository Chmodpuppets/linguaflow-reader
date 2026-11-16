// 镜像 Word Atlas（词光）CC BY 4.0 词库文本到 public/atlas/，供阅读器离线查词增强。
// 只镜像文本（index.json + entries/*.json，约 7MB）；插画/录音仍按需从 CDN 懒加载（渐进增强）。
// 数据授权：CC BY 4.0，署名 "Word Atlas contributors — CC BY 4.0"。见 public/atlas/ATTRIBUTION.md。
// 幂等：index.json 与全部词条块已存在则跳过；下载失败不阻断构建（词库增强是可选层，缺失时回退在线词典）。
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'public', 'atlas');
const BASE = process.env.ATLAS_SOURCE || 'https://cdn.jsdelivr.net/gh/designfuchen/word-atlas@main/public/atlas';
const CHUNK_FALLBACK = 100;

async function exists(p) { try { await access(p); return true; } catch { return false; } }

async function fetchJson(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) { lastErr = err; await new Promise((r) => setTimeout(r, 800 * (i + 1))); }
  }
  throw lastErr;
}

async function main() {
  await mkdir(join(ROOT, 'entries'), { recursive: true });
  let index;
  if (await exists(join(ROOT, 'index.json'))) {
    index = JSON.parse(await readFile(join(ROOT, 'index.json'), 'utf8'));
  } else {
    index = await fetchJson(`${BASE}/index.json`);
    await writeFile(join(ROOT, 'index.json'), JSON.stringify(index));
  }
  const chunk = index.chunk || CHUNK_FALLBACK;
  const blocks = Math.ceil((index.count || index.words.length) / chunk);
  let downloaded = 0;
  for (let n = 0; n < blocks; n++) {
    const file = join(ROOT, 'entries', `${n}.json`);
    if (await exists(file)) continue;
    const data = await fetchJson(`${BASE}/entries/${n}.json`);
    await writeFile(file, JSON.stringify(data));
    downloaded++;
  }
  await writeFile(join(ROOT, 'ATTRIBUTION.md'),
    '# Word Atlas 词库署名\n\n本目录词库文本（index.json 与 entries/*.json）来自 [Word Atlas（词光）](https://github.com/designfuchen/word-atlas)，\n按 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 授权复用。\n\n署名：Word Atlas contributors — CC BY 4.0。\n\n说明：释义、例句为该项目生成式 AI 生成，经自动校验、未逐条人工审校，可能有误；非官方雅思词表。\n插画与录音按需从源站 CDN 懒加载，同样按 CC BY 4.0 署名复用；本仓库不镜像媒体二进制。\n');
  console.log(`[prepare-atlas] ✅ 词库就绪：${index.count || index.words.length} 词 / ${blocks} 块（本次下载 ${downloaded} 块）`);
}

main().catch((err) => {
  console.warn(`[prepare-atlas] ⚠️ 词库下载失败（不阻断构建，查词增强将回退在线词典）：${err?.message || err}`);
});
