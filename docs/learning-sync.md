# 学习记录同步（P1 opt-in · P2 计划下发 · P3 难度匹配）

> 三产品学习闭环的地基。reader 是「学习现场」，只负责捕获与练习；**复习调度与学习计划归 pathmora**；linguaflow 提供账号 + 词典 + 同步底座。

## 原则

- **默认关闭、明确告知。** 未开启同步时不收集、不上报任何学习事件。开启前在设置页讲清：同步什么（查词 / 收藏句子 / 跟读 / 复习）、为什么（供 pathmora 制定学习计划）、以及**书籍文件仍只留在本设备**。
- **阅读是奖励。** 同步不改变「阅读本身是奖励」的定位；计划应保护阅读时间，而不是把阅读变成任务。
- **离线优先。** 事件先入本机队列（localStorage，上限 500 条），联网 / 周期（60s）/ 手动补传；失败保留队列重试。
- **统一原子是「你遇到的那句句子」。** 事件携带 word / sentenceId / bookId，便于 pathmora 以句子为单位调度复习。

## 事件契约

`POST {base}/learn/events`，`Authorization: Bearer <token>`，body `{ events: LearnEvent[] }`（单批 ≤200）。

```ts
type LearnEventType = 'lookup' | 'save_sentence' | 'shadow' | 'review';
interface LearnEvent {
  type: LearnEventType;
  word?: string;
  sentenceId?: string;
  bookId?: string;
  payload?: Record<string, unknown>; // ≤4000 字符
  at: number; // epoch ms
}
```

- `lookup`：点词查义（Reader）。
- `save_sentence`：收藏句子，payload `{text, meaning, chapterTitle}`。
- `shadow`：跟读练习落盘后，payload `{accuracy, wpm, wordCount, duration}`。
- `review`：复习结果，payload `{result: again|hard|good|easy, mode}`。

## 汇总（供 pathmora 消费）

`GET {base}/learn/summary`（Bearer）返回学习者模型：
`knownWords`（review good/easy）、`weakWords`（again/hard 计数）、`counts`、`savedSentences`、`shadow{sessions,avgAccuracy,avgWpm}`、`activityDays`。
pathmora 据此做复习调度与「今日十分钟」计划（P2），以及覆盖率难度匹配选书（P3）。**linguaflow 只记录 + 汇总，不做调度。**

## 账号

复用 linguaflow 账号体系：`POST {base}/auth/register|login` → `{token}`。reader 存于 `localStorage['lf_sync_token']`；开关 `lf_learn_sync_enabled`；队列 `lf_learn_queue`。base 默认 `https://linguaflow.pathmora.cn/api`（与共享词典同源，可用 `pathmora_dict_base` 覆盖）。

## 代码位置

- 客户端：`src/lib/learning.ts`（队列 / 补传 / 账号 / 开关）。
- 上报点：`src/App.tsx`（save_sentence / shadow / review）、`src/components/Reader.tsx`（lookup）。
- 同意 UI：`src/components/Settings.tsx` `LearningSyncCard`。
- 服务端：linguaflow `server/src/learn.ts`（`registerLearnRoutes`），表 `learn_events`。

## P2 · pathmora 下发今日计划，reader 执行

- **调度归 pathmora。** pathmora `server/src/readerReviewPlan.ts` `buildReaderPlan(summary)` 是纯函数：薄弱词（misses 降序）优先 + 已掌握词间隔强化，补满每组 12 词；输出 `ReaderPlan{todayMinutes:10, readingRewardMinutes:15, due[], stats}`。
- **路由** `GET /api/reader/plan`（pathmora `server/src/readerPlanRoutes.ts`）：用 linguaflow Bearer token 服务端转取 `{LINGUAFLOW_API_BASE}/learn/summary`（账号统一前不依赖 pathmora 登录态），8s 超时；跨域 `Access-Control-Allow-Origin: *`（Bearer 无 cookie，安全）。
- **reader 执行** `src/lib/learning.ts` `fetchReaderPlan()`（base 默认 `https://www.pathmora.cn/api`，可用 `pathmora_plan_base` 覆盖；仅开启+有 token 才请求，6s 超时）。`src/components/Review.tsx` 挂载拉取，`start()` 按 `plan.due` 词序映射本地词条。setup 页 `.plan-banner` 展示「今日10分钟 + 薄弱词数 + 阅读奖励15分钟」。
- **三级降级**：pathmora 计划优先（`source:'pathmora'`）→ 不可达时 `fetchFallbackPlan()` 用已部署的 linguaflow `/learn/summary` 本地排程（薄弱词优先+已知词强化，`source:'fallback'`，横幅标「本地计划·连接 pathmora 后自动升级」）→ 两者都不可达才回退纯本地 SRS。阅读/复习全程不被阻塞；**调度权威仍归 pathmora**，fallback 仅为离线/未部署期的连续性。
- **部署（已上线）**：pathmora 大脑以**独立微服务**部署（`systemd pathmora-reader-plan.service`，127.0.0.1:3010；Caddy `handle /api/reader/plan*` 路由），不重编主产品（其 release 存在 src/schema 漂移），主产品零影响、可独立手动回滚。详见 pathmora `server/READER_PLAN_DEPLOY.md`。reader `fetchReaderPlan()` 在生产即取 `source:'pathmora'`；微服务不可达时自动降级。此部署不改变主产品 `releaseReady` 门槛。

## P3 · 覆盖率难度匹配（选书 + 难度标签）

- **纯函数** `src/lib/difficulty.ts`：`bookWordFreq`（内容词词频，去功能词/纯数字/单字符）、`coveragePercent`（词频加权：已知词词次 / 全书词次）、`difficultyBand`（≥98 轻松 / 90–98 适中·i+1 / 75–89 进阶 / <75 挑战）、`bookDifficulty`（带词频缓存；已知词为空返回 null 不评估）。
- **已知词来源**：`learning.ts` `refreshKnownWords()` 拉 `{base}/learn/summary` 的 `knownWords`（pathmora 积累），本机缓存 10 分钟 TTL；未连接 / 不可达回退**本地**已掌握词（复习 good/easy ∪ familiarity≥3）。App 合并两者传 Library。
- **展示**：书库卡片与「继续阅读」hero 显示 `difficulty-badge`（分档 + 覆盖率%）；落在 i+1 区间额外显示「匹配你的水平」chip。已知词为空时不渲染徽章（不误导）。
- **离线优先**：覆盖率在本机计算，不上传书籍内容；已知词仅拉取词表。

## P3+ · 选书推荐（排序 + i+1 筛选）

- 书库新增工具条（仅当有已知词来源时显示）：`综合 / 难度匹配` 排序切换 + 「只看 i+1 · 匹配你的水平」筛选。
- 难度匹配排序：i+1（90–98%）的书优先，其余按覆盖率与 94% 的接近程度排序；无法评估的书排最后。筛选只保留 i+1。
- 纯前端、本机计算，不上传书籍内容；无已知词时工具条隐藏（不误导）。

## 账号统一（已实现 · 以 pathmora 账号为准）

用户拍板：**以 pathmora 账号为准**。实现为「linguaflow 身份桥接 + reader 默认 pathmora 登录」，不移动学习数据、不破坏旧账号：

- **linguaflow 桥接** `server/src/pathmoraIdp.ts`：`auth` 中间件本地 `getUserByToken` 优先（向后兼容）；未命中时把 Bearer token 交 pathmora `GET {PATHMORA_API_BASE}/auth/me` 服务端校验（5s 超时 + 5min 缓存），按 `users.external_provider='pathmora' / external_id` 映射或创建影子用户（唯一索引）。开关 `ENABLE_PATHMORA_IDP`（默认开，置 `0` 即回退纯本地）。
- **reader** 连接默认 `pathmora`（邮箱登录，`connectAccount('pathmora', email, …)`），token 存 `lf_sync_token`；linguaflow `/learn/*` 经桥接信任该 token。保留 `linguaflow` 账号作为回退选项。
- **数据归属**：学习数据仍在 linguaflow，按影子用户 id 归属。旧 linguaflow 账号（username，无 email 列）**不自动迁移**；如需与 pathmora 账号合并需另行数据迁移。
- **pathmora 注册为邀请制**（`BETA_INVITE_REQUIRED`），故 reader 默认「已有账号」登录；创建 pathmora 账号需邀请码。
- 验证：桥接隔离单测 3/3（桩 fetch + 临时 DB）；线上本地 token 200 / 坏 token 401（向后兼容）；reader 单测 45/45、E2E 全绿。

## 后续

- 旧 linguaflow 账号 → pathmora 账号的数据合并迁移：经只读评估**当前无必要**（44 本地账号 / 0 影子 / 无 email 列 / 仅 4 条测试事件）；如未来产生真实跨账号数据再议。
- 主产品 release 的 src/schema 漂移修复后，可把大脑路由并回主 `index.ts`（当前由独立微服务承担，二者等价）。
