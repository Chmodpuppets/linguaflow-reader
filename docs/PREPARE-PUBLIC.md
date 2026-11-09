# 转 public 上线清单（Runbook）

## ✅ 已执行（2026-11-09 03:30，Mike 明确确认后）

| 动作 | 结果 |
|---|---|
| 旧 private 仓改名 | `Chmodpuppets/linguaflow-reader-legacy`，保持 **private**（含历史，作兜底） |
| 新建同名仓 | `Chmodpuppets/linguaflow-reader`，先 private → 核对 → 转 **public** |
| 推送方式 | `github.com` git 协议在本机被代理挡（`000`），改走 `api.github.com` Git Data API：58 blob → tree → 单一 root commit → force PATCH `refs/heads/main` |
| 最终历史 | `main` **1 个 commit** `47298462`，58 文件、0.92MB，无占位文件 |
| 上线前核对 | 无认证视角 `private=false`、legacy 返回 **404**；逐文件扫 53 个文本 **0 命中书籍正文、0 禁用路径**，二进制仅 2 个自有 LOGO |
| 误推防护 | 本机老工作区 `origin` 已改到 `linguaflow-reader-legacy.git`；干净工作副本放在 `~/Documents/linguaflow-reader-public` |

公开地址：**https://github.com/Chmodpuppets/linguaflow-reader**

> 实际执行比本文件原方案更稳：新仓**先 private → push → 核对 → 最后才转 public**，
> 且没有使用 force push 到旧仓。下方 Step 1–5 保留作为过程记录与复跑参考。

---

**以下为原始 runbook（保留作记录）。**

---

## 0. 已验证的事实（2026-11-09）

| 检查 | 结果 |
|---|---|
| 仓库历史 | **只有 1 个 commit** `cb8fdba`，且它包含 226 张扫描图与书籍正文 TS |
| 当前索引 | 版权资产已 `git rm --cached` 移出；`git ls-files public/books qa` = 0 |
| 本机文件 | 扫描图 227 / `qa` 14 / 数据 TS 2 / `public/local-content` JSON 2 **全部保留在本机**，仅不入库 |
| 公开快照 | `npm run prepare:public` → **56 个文件 / 0.92 MB**，审计结论 ✅ 无版权素材、无书籍正文、无未授权二进制 |
| 快照可构建 | 独立目录内 `npm run typecheck` 0 错、`npm run build` 10.23s 全绿；`dist` JS 搜不到书籍正文，`dist/books` 与 `dist/local-content` 均为 0 文件 |
| 产物 | dist 15MB，SW 缓存名已构建期哈希化，预缓存清单 16 条 0 缺失 |

快照默认在 `/tmp/linguaflow-reader-public`，可用 `PUBLIC_SNAPSHOT_DIR=/your/path npm run prepare:public` 换位置。
报告在同目录 `PUBLIC-SNAPSHOT-REPORT.md`（含完整文件清单）。

---

## 1. 三个方案，先看清代价

| 方案 | 做法 | 代价 / 风险 |
|---|---|---|
| **C（推荐）** | 旧 private 仓改名留作备份 → 新建同名 **空 public 仓** → 快照 `git init` + **普通 push** | 不需要 force push；旧历史完整留在私有 legacy 仓做兜底；新仓从第一个 commit 起就干净。唯一动作是给私有仓改名（影响面≈0） |
| A | 在现有仓重写唯一 commit → `force push` → 网页转 public | 保留仓库身份 / URL，但需要 force push（不可逆），且转 public 后「重写过的历史」全世界可见 |
| B | 直接把现有 private 仓转 public | ❌ **不可行**：历史里版权内容仍在，一转就公开分发 |

> 之前倾向 A，是因为「只有 1 个 commit，重写成本≈0」。但 C 连 force push 都省了，
> 还把旧历史留成私有备份 —— 万一之后发现漏了什么，有得救。**推荐 C。**

---

## 2. 方案 C 的确切命令（**待 Mike 确认后执行**）

### Step 1 · GitHub 网页（手工，AI 不代操作）

1. 打开 `https://github.com/Chmodpuppets/linguaflow-reader/settings`
2. **Repository name** 改成 `linguaflow-reader-legacy`，保持 **Private** —— 这是含版权历史的备份仓
3. 新建仓库 `linguaflow-reader`，可见性选 **Public**，**不要**勾选 README / LICENSE / .gitignore（保持全空）

### Step 2 · 本地生成干净快照

```bash
cd /Users/mike/Documents/linguaflow-reader
PUBLIC_SNAPSHOT_DIR=$HOME/Documents/linguaflow-reader-public npm run prepare:public
# 确认输出「✅ 未发现版权素材、书籍正文或未授权二进制」
cat "$HOME/Documents/linguaflow-reader-public/PUBLIC-SNAPSHOT-REPORT.md"
```

### Step 3 · 初始化并推送

```bash
cd "$HOME/Documents/linguaflow-reader-public"
git init -b main
git add -A
git commit -m "feat: local-first reader + voice lab (public release)"
git remote add origin https://github.com/Chmodpuppets/linguaflow-reader.git
git push -u origin main          # 普通 push，不是 force
```

> 本机已配 `git http.version=HTTP/1.1`（防 push framing 报错）。
> 若 Step 1 没把旧仓改名，这一步会因同名冲突失败 —— 正好是个安全闸。

### Step 4 · 推完先别急着庆祝

在 **Public 仓**网页确认：

- [ ] 文件列表里**没有** `public/books/`、`qa/`、`src/data/wimpyKidBook.ts`、`src/data/wimpyKidAudioMap.ts`
- [ ] 只有 1 个 commit，`git log --oneline` 干净
- [ ] `THIRD-PARTY-NOTICES.md`、`LICENSE`、`README.md` 都在
- [ ] 搜一下 `Greg Heffley` / `Rodrick woke me`（GitHub 代码搜索）无命中

### Step 5 · 收尾

- 旧 `linguaflow-reader-legacy` 保持 **Private**，别删（兜底）
- 本机开发仓继续用 `/Users/mike/Documents/linguaflow-reader`，本机素材照常可用
- 想让本机仓跟新 public 仓同步，再单独处理 remote（**另一次需要确认的操作**）

---

## 3. 不可逆风险（必须知道）

- **Step 1 改名 + Step 3 push** 之后，新 public 仓的内容立刻对全世界可见，且会成为克隆者的第一个 commit。
- 旧私有仓里的版权历史**不会自动消失**，只是不再挂在公开仓库名下。若将来把 legacy 仓也转 public，同样会泄露。
- 本机 `.git` 的 `cb8fdba` 历史仍在（本机私有，不是问题）；但**不要**把它 push 到任何公开仓。
- 若还有其它分支 / tag / fork 指向 `cb8fdba`，需一并检查（当前 `git log --all` 只有这一个 commit）。

---

## 4. 上线后已完成 / 增量同步

✅ **已完成（2026-11-09）**

- 仓库描述 + 10 个 topics
- annotated tag `v0.1.0`（指向首个发布 commit `114909f8`，不会随后续 commit 移动）
- README 顶部补「新 clone 不含内置示例书素材」提示、「无云端」口径改成「仅首次下载模型需联网」
- 备份恢复校验增强（去原生 `alert`、20MB 上限、字段/主题校验、成功提示）
- SW 运行时缓存与预缓存分离 + 120 条上限裁剪
- 死代码清理：`fallbackBuiltinBooks` / `aiPolishResult` / `DiffStatus 'pause'`

🔧 **后续怎么同步代码到公开仓**（`github.com` git 协议在本机被代理挡，走 `api.github.com`）

```bash
npm run prepare:public                      # 重新生成并审计干净快照
npm run sync:public -- --dry-run            # 只看增量 diff，不推送
PUBLIC_COMMIT_MESSAGE="feat: ..." npm run sync:public
```

`sync:public` 用 **Git blob sha1** 对比本地快照与远端 tree，只为变化的文件建 blob，
基于 `base_tree` 生成新 tree、以远端 head 为 parent 建 commit，最后更新 `refs/heads/main`。
所以是**线性历史**、单次只发几个请求，不用全量重推 58 个文件。

仍待办：P2 / P3 代码打磨见 [`audit-2026-11-07.md`](audit-2026-11-07.md) 第 10 节。

---

## 5. 边界说明

原 runbook 起草时 Mike 尚未授权对外动作，因此当时停在 Step 1 之前；
2026-11-09 取得明确确认后，已按文首「已执行」表完成。
`prepare:public` 始终是纯本地脚本（复制 + 扫描 + 报告），不碰 git、不碰远端。
Step 1–3 属于对外且不可逆的动作，永远不会在未经确认时自动执行。
