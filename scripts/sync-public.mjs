/**
 * 把本机干净快照**增量**同步到公开仓库（单个线性 commit）。
 *
 * 用于 `github.com` 的 git 协议被网络阻断、但 `api.github.com` 可用的环境。
 * 做法：用 Git blob sha1 对比本地快照与远端 tree，只为变化的文件创建 blob，
 * 然后基于 `base_tree` 生成新 tree → commit（parent = 远端 head）→ 更新 refs/heads/main。
 *
 * 前置：先跑 `npm run prepare:public` 生成干净快照。
 * 用法：npm run sync:public -- --dry-run   # 只看 diff，不推送
 *      npm run sync:public                 # 真正同步
 *
 * 环境变量：PUBLIC_SNAPSHOT_DIR / PUBLIC_REPO_OWNER / PUBLIC_REPO_NAME / PUBLIC_COMMIT_MESSAGE
 *
 * 安全：凭证只在 curl 参数里使用；execFileSync 的原始错误**绝不能透传**
 * （它的 message 含完整命令行，包括 Authorization header）。
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const OWNER = process.env.PUBLIC_REPO_OWNER || 'Chmodpuppets';
const REPO = process.env.PUBLIC_REPO_NAME || 'linguaflow-reader';
const SNAPSHOT = process.env.PUBLIC_SNAPSHOT_DIR || '/tmp/linguaflow-reader-public';
const MESSAGE = process.env.PUBLIC_COMMIT_MESSAGE || 'chore: sync clean source snapshot';
const DRY_RUN = process.argv.includes('--dry-run');

const credentials = readFileSync(`${process.env.HOME}/.git-credentials`, 'utf8');
const tokenMatch = credentials.match(/^https:\/\/[^:]+:([^@]+)@github\.com$/m);
if (!tokenMatch) throw new Error('未找到 GitHub 凭证（~/.git-credentials）');
const TOKEN = tokenMatch[1];

function api(method, path, body) {
  const args = [
    '-s', '--max-time', '40', '-w', '\n%{http_code}', '-X', method,
    '-H', `Authorization: Bearer ${TOKEN}`,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'Content-Type: application/json',
    `https://api.github.com${path}`,
  ];
  if (body !== undefined) args.push('-d', JSON.stringify(body));
  let out;
  try {
    out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`${method} ${path} 请求失败（curl 退出码 ${error && error.status ? error.status : 'unknown'}）`);
  }
  const cut = out.lastIndexOf('\n');
  const code = Number(out.slice(cut + 1).trim());
  let parsed;
  try { parsed = JSON.parse(out.slice(0, cut)); } catch { throw new Error(`${method} ${path} 返回非 JSON`); }
  // commit 响应里的 message 是提交信息，不是报错；一律按 HTTP 状态码判断。
  if (code < 200 || code >= 300) throw new Error(`${method} ${path} HTTP ${code}: ${parsed.message || ''}`);
  return parsed;
}

/** Git blob sha1 = sha1("blob <bytes>\\0" + content)，与 GitHub 返回的 blob sha 可比。 */
function blobSha(content) {
  return createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
}

function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist'].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (statSync(full).isFile()) out.push(relative(base, full).split(sep).join('/'));
  }
  return out.sort();
}

const head = api('GET', `/repos/${OWNER}/${REPO}/commits/main`);
const baseTreeSha = head.commit.tree.sha;
const remoteTree = api('GET', `/repos/${OWNER}/${REPO}/git/trees/${baseTreeSha}?recursive=1`);
if (remoteTree.truncated) throw new Error('远端 tree 被截断，无法安全增量同步');
const remote = new Map((remoteTree.tree || []).filter((item) => item.type === 'blob').map((item) => [item.path, item.sha]));

const local = new Map();
for (const path of walk(SNAPSHOT)) {
  const content = readFileSync(join(SNAPSHOT, path));
  local.set(path, { sha: blobSha(content), content });
}

const modified = [...local.keys()].filter((path) => remote.get(path) !== local.get(path).sha);
const removed = [...remote.keys()].filter((path) => !local.has(path));
console.log(`[sync] 远端 ${remote.size} 文件 / 本地 ${local.size} 文件`);
console.log(`[sync] 新增或修改 ${modified.length} 个${modified.length ? ': ' + modified.join(', ') : ''}`);
console.log(`[sync] 删除 ${removed.length} 个${removed.length ? ': ' + removed.join(', ') : ''}`);

if (!modified.length && !removed.length) {
  console.log('[sync] 已是最新，无需提交。');
  process.exit(0);
}
if (DRY_RUN) {
  console.log('[sync] dry-run，未推送。');
  process.exit(0);
}

const changes = [];
for (const path of modified) {
  const blob = api('POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
    content: local.get(path).content.toString('base64'),
    encoding: 'base64',
  });
  changes.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
}
for (const path of removed) changes.push({ path, mode: '100644', type: 'blob', sha: null });

const tree = api('POST', `/repos/${OWNER}/${REPO}/git/trees`, { base_tree: baseTreeSha, tree: changes });
const commit = api('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
  message: MESSAGE,
  tree: tree.sha,
  parents: [head.sha],
});
api('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/main`, { sha: commit.sha });
console.log(`[sync] 已提交 ${commit.sha.slice(0, 8)} → main`);

const check = api('GET', `/repos/${OWNER}/${REPO}/git/trees/main?recursive=1`);
const files = (check.tree || []).filter((item) => item.type === 'blob').map((item) => item.path);
console.log(`[verify] 远端文件 ${files.length} 个 | truncated=${Boolean(check.truncated)}`);
const forbidden = files.filter((path) => /^public\/books\/|^public\/local-content\/|^public\/wasm\/|^public\/models\/|^qa\/|^dist\/|wimpyKid(Book|AudioMap)\.ts|^node_modules\/|^\.workbuddy\//.test(path));
console.log(`[verify] 禁用路径: ${forbidden.length ? forbidden.join(', ') : '0 ✅'}`);
