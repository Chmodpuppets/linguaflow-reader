# 学习记录同步（P1 · opt-in）

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

## 后续

- P2：pathmora 复习调度 + 今日十分钟；reader 复习页改为执行下发任务。
- P3：覆盖率（书词 ∩ 已知词 / 书词，词频加权）90–98% 判 i+1 选书 + reader 难度标签。
