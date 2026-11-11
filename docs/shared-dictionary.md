# 共享词典服务（Pathmora 统一 · 第一步）

目标：**pathmora / linguaflow / linguaflow-reader 三个产品共用同一个词典服务**，作为后续「大统一」（账号通用、数据打通）的第一块公共基础设施。查词不再各产品各维护一份，也不再「一个单词调一次大模型」。

## 1. canonical 服务端契约

服务实现：`linguaflow` 仓 `server/src/dict.ts`（Hono + better-sqlite3，只读）。数据为四语 SQLite（en/ja/ko/es），英语 ECDICT 约 39.5 万词。

| 接口 | 说明 |
| --- | --- |
| `GET {base}/dict/lookup?w=<word>&lang=<en\|ja\|ko\|es>&alt=<c1,c2,…>` | 查词。`alt` 为客户端生成的活用候选（服务端不重复实现形态规则）。返回 `{found,lang,word,phonetic,meaning,pos}`；`meaning` 为中文释义；未命中 `404 {found:false}` |
| `GET {base}/dict/stats` | 各语就绪状态 / 词数 / 字节数 |

- **base（canonical）**：`https://linguaflow.pathmora.cn/api`（同源反代到 `127.0.0.1:8787`）。未来统一域名（如 `https://api.pathmora.cn`）只需改 base，客户端契约不变。
- **CORS**：`/dict/*` 对**所有 Origin 开放**（`Access-Control-Allow-Origin: *`），其余接口仍收紧到 `CORS_ORIGIN`。见 `linguaflow` 仓 `server/src/index.ts`（commit `645b124a`）。查词无 cookie、无敏感数据，开放 Origin 不引入 CSRF 风险。这是三产品跨域共用的前提。
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
| **pathmora** | 复用同一份参考客户端（vendor `remoteDictionary.ts` 或抽成共享包），指向同一 canonical base；不要另起词典后端 |

## 4. 与「大统一」的衔接

- **账号通用**：统一登录后把 token 写入 `pathmora_auth_token`，三产品查词自动携带；服务端届时可在 `/dict` 读取 token 做按账号限流 / 生词本同步，契约不变。
- **域名统一**：base 可整体迁到 `api.pathmora.cn`，客户端只改 `setDictionaryBase` / 环境变量。
- **数据统一**：查词命中可上报为统一生词本（未来），当前仅查单词本身，不上传阅读数据。

## 5. 部署注意

CORS 开放改动（`645b124a`）在 `linguaflow` 仓 main，**线上服务器需重新部署 / 重启后才生效**；生效前跨域浏览器调用仍会被旧 `CORS_ORIGIN` 拦截（客户端会自动回退免费词典 / 本地词库，不报错）。部署见 `linguaflow` 仓 `scripts/deploy-online.sh` 与 `server/deploy/`。

## 6. 数据许可

en=ECDICT(MIT)；ja=JMdict/jamdict-cn(CC BY-SA 4.0)；ko=Open Yonsei(CC BY-SA 3.0)；es=WikDict/DBnary(CC BY-SA)。再分发须保留署名与相同许可，见 `linguaflow` 仓 `public/dict/LICENSES.md`。
