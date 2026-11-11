# 共享词典服务（Pathmora 统一 · 第一步）

目标：**pathmora / linguaflow / linguaflow-reader 三个产品共用同一个词典服务**，作为后续「大统一」（账号通用、数据打通）的第一块公共基础设施。查词不再各产品各维护一份，也不再「一个单词调一次大模型」。

## 1. canonical 服务端契约

服务实现：`linguaflow` 仓 `server/src/dict.ts`（Hono + better-sqlite3，只读）。数据为四语 SQLite（en/ja/ko/es），英语 ECDICT 约 39.5 万词。

| 接口 | 说明 |
| --- | --- |
| `GET {base}/dict/lookup?w=<word>&lang=<en\|ja\|ko\|es>&alt=<c1,c2,…>` | 查词。`alt` 为客户端生成的活用候选（服务端不重复实现形态规则）。返回 `{found,lang,word,phonetic,meaning,pos}`；`meaning` 为中文释义；未命中 `404 {found:false}` |
| `GET {base}/dict/stats` | 各语就绪状态 / 词数 / 字节数 |

- **base（canonical）**：`https://linguaflow.pathmora.cn/api`（同源反代到 `127.0.0.1:8787`）。未来统一域名（如 `https://api.pathmora.cn`）只需改 base，客户端契约不变。
- **CORS**：`/dict/*` 对**所有 Origin 开放**（`Access-Control-Allow-Origin: *`），其余接口仍收紧到 `CORS_ORIGIN`。见 `linguaflow` 仓 `server/src/index.ts`（commit `645b124a`）。查词无 cookie、无敏感数据，开放 Origin 不引入 CSRF 风险。这是三产品跨域共用的前提。**已部署到线上并验证**：跨域 `GET` 与 `OPTIONS` 预检均返回 `Access-Control-Allow-Origin: *`，且允许 `Authorization` 头（统一账号 Bearer 可跨域携带）。
- **鉴权**：`/dict/*` 公开只读、**无需登录**；按 IP 限流（默认 1200 次/小时）。客户端可带 `Authorization: Bearer <token>`（统一账号预留），服务端当前忽略。
- **缓存**：命中 `Cache-Control: public, max-age=604800`，未命中 `max-age=86400`。

## 2. 共享客户端（参考实现）

`src/lib/remoteDictionary.ts` 是可被三个产品直接复用的参考客户端：

- `fetchRemoteDictionary(word)`：共享服务器英汉词典优先 → 免费 Free Dictionary API 二次兜底 → 返回 `null`（调用方回退本地词库）。内存缓存 + 6s 超时 + `navigator.onLine` 短路，任何失败不抛错。
- `setDictionaryBase(base)` / `getDictionaryBase()`：覆盖 canonical base（自托管 / 未来统一域名）。也可用 `localStorage['pathmora_dict_base']` 持久覆盖。
- **统一账号钩子**：读取 `localStorage['pathmora_auth_token']`，存在则自动带 `Authorization: Bearer`。现在 `/dict` 忽略它；统一登录后无需改客户端即可按账号个性化 / 限流 / 计费。

## 3. 各产品接入方式

| 产品 | 接入 |
| --- | --- |
| **linguaflow** | 已接：`services/dictionary.ts` 走同源 `{COMMUNITY_URL}/dict/lookup` + 浏览器离线包（`public/dict/<lang>/*.json.gz`）+ AI 兜底。与共享服务同一后端 |
| **linguaflow-reader** | 已接：本仓 `src/lib/remoteDictionary.ts` 跨域调用 canonical base（CORS 已开放），本地 15 词学习词库优先 |
| **pathmora** | 已接：`linguasphere` 仓（包名 langvault，部署于 `/opt/pathmora`）`services/sharedDictionary.ts`，同一契约、同一 canonical base，携带 Pathmora 现有 `auth_token`。Pathmora 现为 AI 教练产品、尚无点词查词 UI，该客户端供其阅读 / 练习 / 教练需要确定性查词时调用；不要另起词典后端 |

> **pathmora 代码身份**：pathmora 是域名 / 品牌，其代码即 `Chmodpuppets/linguasphere` 仓（本机 `/Users/mike/Downloads/pathmora/linguasphere`，包名 `langvault`）。它与 linguaflow 是两套独立前后端；共享词典是二者第一块公共基础设施。

## 4. 与「大统一」的衔接

- **账号通用**：统一登录后把 token 写入 `pathmora_auth_token`，三产品查词自动携带；服务端届时可在 `/dict` 读取 token 做按账号限流 / 生词本同步，契约不变。Pathmora 现有登录态存于 `localStorage['auth_token']`，其共享客户端已「统一键优先、回退 auth_token」，统一时只需把同一 token 也写入 `pathmora_auth_token`（或收敛键名），无需改查词逻辑。
- **域名统一**：base 可整体迁到 `api.pathmora.cn`，客户端只改 `setDictionaryBase` / 环境变量。
- **数据统一**：查词命中可上报为统一生词本（未来），当前仅查单词本身，不上传阅读数据。

## 5. 部署状态

- **linguaflow API（CORS 开放）**：✅ 已部署生效。改动 `645b124a` 已应用到线上 `/opt/linguaflow-server/src/index.ts`（原文件备份为 `index.ts.bak-*`）并重启 `linguaflow-sync.service`；实测跨域 `GET`/`OPTIONS` 均返回 `Access-Control-Allow-Origin: *`。注意 `scripts/deploy-online.sh` 只传前端静态文件、不会重启 API，API 改动需单独更新 `/opt/linguaflow-server` 并重启该 service。
- **linguaflow-reader**：✅ 已推送公开仓，且**已部署到线上 `reader.pathmora.cn`**（静态根 `/opt/linguaflow-reader-web`，部署前备份为 `linguaflow-reader-web.bak-*`；保留服务器侧 `books/`、`local-content/`、`wasm/`）。实测线上 Reader chunk 含 `SERVER DICTIONARY`/`dict/lookup`/`pathmora_dict_base`，precache 版本与本地构建一致。注意：推 GitHub 不会自动部署该静态站，需单独更新 `/opt/linguaflow-reader-web`。
- **pathmora**：共享客户端 `services/sharedDictionary.ts` 已加入 `linguasphere` 仓并通过 typecheck；**尚未部署到 `/opt/pathmora`**（Pathmora 走 releases 发布流程，且当前无查词 UI 调用它，部署与否不影响现有功能）。需要时随 Pathmora 下次发布一并上线。

## 6. 数据许可

en=ECDICT(MIT)；ja=JMdict/jamdict-cn(CC BY-SA 4.0)；ko=Open Yonsei(CC BY-SA 3.0)；es=WikDict/DBnary(CC BY-SA)。再分发须保留署名与相同许可，见 `linguaflow` 仓 `public/dict/LICENSES.md`。
