<p align="center">
  <img src="public/linguaflow-logo.png" width="320" alt="LinguaFlow">
</p>

# LinguaFlow Reader

一个把「读」和「说」接起来的本地优先阅读器。读完一句，就地跟读；说完一段，立刻看到差距。

纯前端，无后端、无账号。书 / 词 / 笔记 / 录音全部留在本机 IndexedDB，不上传。
需要联网的环节都可选：**首次启用本地 Whisper 时下载模型**（默认 `hf-mirror.com`，可切到自托管 `/models/` 完全离线）、**点词查义的在线词典兜底**（本地词库未收录时才请求：优先项目自有 LinguaFlow 服务器英汉词典，其次免费 Free Dictionary API；离线自动回退本地词库），以及**学习记录同步**（默认关闭；开启后查词 / 收藏句子 / 跟读 / 复习记录上报到你的账号，供 pathmora 制定学习计划，书籍文件仍只留在本设备，见 [docs/learning-sync.md](docs/learning-sync.md)）。转写推理与阅读本身均在浏览器本地完成。

## 功能模块

导航共 7 项：书库（点开书进入阅读器）、词汇本、复习、口语实验室、声波与成长统计、笔记、设置。
下面按三条主线介绍核心能力。

**阅读器**
- EPUB 导入（JSZip + DOMParser）与内置样书；章节以书自带目录（EPUB3 nav / EPUB2 NCX）为准，扉页 / 目录页 / 版权页不占章节，避免章节错位
- **导入任何文本**（LingQ 式）：粘贴文章 / .txt / .md 一键变成可阅读、可注音、可统计的书；空行分段、标题分章
- **学习仪表盘**：已掌握词 / 学习中 / 连续学习天数 / 每日目标（可调），把「逐渐裸页」的进步变成可感知的数字
- **分级入门书架**：A1/A2 公版寓言简写 + B1 寓言与《爱丽丝》经典桥 + B2《盖茨比》《秘密花园》双原著桥（带 CEFR 徽章与预置注音），形成 A1→原著 的完整阶梯，冷启动也能「读得动」
- 扫描书模式：原图 + OCR 文字层，点图上单词即可查义
- 轻点查词（本地词库优先，未收录时服务器英汉词典兜底、再退免费词典 API，离线回退本地）、划选标记、目录抽屉、字号/行高/主题、键盘翻页
- **常驻注音 + 词状态**：入门书预置几个「学习中」示范词，新用户打开即见注音；查词面板可把词标为「学习中」（原文该词上方常驻中文注音）或「已掌握」（移除注音）；章首实时显示已掌握/学习中/覆盖率/裸页率，掌握越多页面越「裸」，进步可感知。版式面板可切换注音模式（关闭/仅学习中/全部有释义）。词状态与注音缓存只存本机、随备份，不上传；标为「已掌握」的词会直接计入已知词，驱动下面的难度匹配与今日推荐
- **难度匹配 + 今日推荐**：按已知词计算每本书的词频加权覆盖率，90–98% 标为 i+1；书库可「难度匹配」排序 /「只看 i+1」，并在顶部给出「今日推荐」——挑最接近你水平的一本并说明理由，把「该读哪本」的决策也接进闭环；还没有已知词的新用户则给「入门推荐」，从最轻松的分级读起
- 有声书页码锚点（AudioBar 与章节对齐，刷新后保持）
- **词汇本管理**：搜索 + 筛选（全部/学习中/熟悉）+ 排序（最近/字母/熟练度）+ List/Gallery 翻卡视图；批量模式可全选/勾选后一次删除，支持撤销

**主动复习**
- 三种练习：Flashcards（先回忆再揭示）/ 原文挖空 / **句子回译**（看着中文释义把收藏句子里缺的词写回来，在语境中主动提取）
- 收藏的句子自动进入复习队列；练习结果计入复习记录与连续天数，并强化对应单词的间隔复习（SRS）
- **删除可撤销**：删除标记 / 词条 / 收藏句子后，提示条提供 6 秒「撤销」窗口，一键恢复（词条连同复习记录一起恢复）；删书因级联清理音频仍走确认
- 连接账号后由 pathmora 学习大脑下发「今日10分钟」顺序（先薄弱词后强化）；不可达时本地降级，阅读不被阻塞

**口语实验室**
- 三种模式：原句跟读 Shadowing / 盲听复述 Cloze Retell（隐藏原文 + 关键词脚手架 + 60s 上限）/ 自由独白 Free Talk（到期词说出口即点亮）
- MediaRecorder 录音 + Web Audio 波形；有原音时显示原音声波，无原音时为静态占位基线并切换系统 TTS 示范
- 转写双引擎：浏览器原生实时识别，或**本地 Whisper**（离线、标点更准、Safari/Firefox 可用）
- Levenshtein 词级 diff（🟢 匹配 / 🟡 低置信 / 🔴 漏读替换）、净语速 WPM、卡顿占比、口头禅统计
- **韵律反馈**（跟读且有原音时）：原音 vs 你的录音逐词重音/拖长对齐（🟢 节奏匹配 / 🟡 弱读拖长 / 🔴 重音缺失），纯前端信号处理，标注「节奏相似度，非发音正确度」
- **可懂度信号**：把 diff 的漏读/替换显式呈现为「可能没被听懂」，逐词听标准音、引导重读——「机器可能没听清」，不是「你读错了」
- **焦点式纠错**：每轮自动选出「本轮唯一焦点」（漏读→重音→拖长→停顿→口头禅），「下一轮只练这个」会在原文高亮该词并提醒，一次只改一个点
- **自我监控**：录完先问「你觉得自己哪里没跟上？」，自评后再展开系统诊断并对比一致性，建立元认知（可跳过）
- **间隔重录**：跟读过的句子按 1/3/7 天回到「间隔重录」队列，显示准确率/语速进步，一键重录——分散练习比当场重复更牢
- **复杂度维度**：Free Talk 统计平均句长/从句/词汇多样性，分「简单/发展中/丰富」并给下一步建议；诚实标注复杂度≠好坏
- 阅读器内选中句子即可拉起跟读抽屉

**声波与成长统计**
- 年度热力图、30 天 WPM / 卡顿双曲线
- Top 10 顽固错词、词汇激活漏斗（收集 → 说出口 ≥1 次 → ≥3 次）
- 同句历史录音 A/B 时间胶囊

> 明确不做的事：不伪造音素评分。词级 diff 来自 STT 对齐，不等同于发音打分。

## 技术栈

React 19 · TypeScript 5.7 · Vite 6 · 原生 CSS（无 Tailwind / 无路由库 / 无状态库）

## 开始

```bash
npm install
npm run dev      # http://127.0.0.1:3012
npm run build
```

`predev` / `prebuild` 会自动执行 `scripts/copy-ort-assets.mjs`，把 onnxruntime-web 的
`ort-wasm-simd-threaded.{mjs,wasm}`（约 14MB）复制到 `public/wasm/`。这个目录不进版本库。

> 新 clone 的仓库**不含内置示例书的扫描图 / 音频 / 正文 JSON**（第三方版权内容，见下方专节）。
> 直接 `npm run dev` 会看到 3 本原创样书，导入自己的 EPUB 即可正常使用；
> 想启用内置扫描书，请把合法获得的素材按该节说明放到本机目录。

## 本地 Whisper

`@huggingface/transformers` 在 Web Worker 里跑 whisper-tiny.en / base.en（wasm，q8 量化）。
主线程负责把录音解码并重采样成 16kHz 单声道，再交给 worker 推理。

模型源三选（UI 里可切，存 `lf-whisper-source`）：

| 源 | 地址 | 适用 |
|---|---|---|
| `mirror`（默认） | `hf-mirror.com` | 国内直连 |
| `official` | `huggingface.co` | 海外网络 |
| `local` | 同源 `/models/` | 自托管 / 内网 / 完全离线 |

**为什么 ONNX 运行时必须自托管**：transformers.js 默认从 jsDelivr 拉 ORT 的 wasm，
国内直连会 SSL 失败；因此本项目用 `env.backends.onnx.wasm.wasmPaths` 指向同源 `/wasm/`。
另外 `numThreads = 1`——没有 COOP/COEP 头就没有 SharedArrayBuffer，多线程会直接报错。

要用 `local` 源，把模型放到（已被 .gitignore 排除）：

```
public/models/Xenova/whisper-tiny.en/
  config.json  generation_config.json  tokenizer.json  tokenizer_config.json
  preprocessor_config.json  added_tokens.json  normalizer.json  vocab.json  merges.txt
  onnx/encoder_model_quantized.onnx
  onnx/decoder_model_merged_quantized.onnx
```

## 绑定自己的原声音频

阅读页工具栏的 **🎧「有声书边听边看」** 按钮是主入口：书已有音频时点它显隐底部播放条；
还没有音频时点它就地在抽屉里绑定（复用设置页「有声书原音」同一套逻辑），绑定成功自动收起抽屉、
展开播放条，立刻边听边看。设置页 →「有声书原音」是管理入口，可为**书库里任意一本书**（含自己导入的
EPUB）绑定本机音频文件（mp3 / m4a / wav / ogg 等）。音频 Blob 存在 IndexedDB 的 `book-audio` store，按 `bookId` 索引：

- 不写进 `AppData`、不进 JSON 备份、不上传，刷新后仍在
- 绑定后阅读页播放条与口语实验室会**优先播放它**，内置书也可换成自己的版本
- 原音加载失败时，口语实验室会降级到系统 TTS 示范音

### 生成句级定位（本地 Whisper）

给已绑定的书点「生成句级定位」，即可让**你自己的音频**支持句子级跟读。全链路在浏览器里：

1. 解码成 16kHz 单声道 PCM（直接让 `AudioContext` 输出 16kHz，避免数倍内存峰值）
2. 按 60s 样本窗切片，逐片交给本地 Whisper（`return_timestamps: true`）
3. segment 时间戳与书的正文行做**单调锚点对齐**（词重叠率 + 字数比例插值）
4. 结果按 `bookId` 存 IndexedDB `alignment` store，重开浏览器不用重跑

对齐数据来源按 `bookId` 区分：内置《Diary of a Wimpy Kid》用预计算静态表，用户音频用运行时结果；
**内置书换成自己的音频、但没生成对齐时不套用旧时间轴**，只会整段播放。

约束（都写在设置页 UI 里）：单次音频 ≤ **16MB**（约 16 分钟），首次启用需下载 40–80MB 模型，
转写在浏览器本地完成、耗时约等于音频时长。整本有声书建议先剪出要练的章节。
不支持扫描图片版 EPUB（没有可对齐的文本）。

## 关于内置扫描书与版权素材

内置《Diary of a Wimpy Kid》的扫描图、有声书音频，以及由其 OCR 得到的正文与时间戳，
都是**第三方版权内容（含衍生文本）**，不属于 MIT 授权范围。处理方式：

- **图片 / 音频**：`public/books/` 与 `qa/` 已 `.gitignore` 并从版本库索引移除；本机文件保留，dev 完整可用
- **正文 / 时间戳**：`src/data/wimpyKidBook.ts` 与 `wimpyKidAudioMap.ts` 同样不入库，只作为本机源数据；
  `npm run export:local-content` 把它们导出到 `public/local-content/*.json`
- **构建**：`dropLocalBookAssets()` 在收尾剔除 `dist/books/` 图片音频 + `dist/local-content/*.json`，
  **公开产物里没有扫描图、音频或书籍正文**（实测 dist 15MB，JS 中搜不到书籍文本）；
  本机构建想保留素材设 `KEEP_LOCAL_ASSETS=1`
- **运行**：应用启动时 `fetch('/local-content/wimpy-kid.json')`，**文件不存在就安静降级为 3 本轻量样书**，
  不白屏、不报错；句级时间戳同理，缺失时回退整段播放

### 在本机启用内置扫描书

```bash
npm run export:local-content    # 需要本机保留那两个源 TS 文件
npm run dev
```

新 clone 的仓库既没有源 TS 也没有 JSON —— 这是刻意的：请改用 EPUB 导入，或在设置页
为你自己的书绑定音频。缺失时阅读页不显示播放条、图片模式给人话提示、口语实验室回退 TTS。

> ✅ **开源状态**：含版权历史的原仓库已改名 `Chmodpuppets/linguaflow-reader-legacy` 并保持私有；
> 本仓库是同名新建的公开仓，**从第一个 commit 起就不含任何第三方书籍素材**。
> 详见 `THIRD-PARTY-NOTICES.md` 与 `docs/PREPARE-PUBLIC.md`。

## 开源合规

依赖许可证与第三方素材声明见 [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md)。
`LICENSE` 的 MIT 只覆盖本仓库原创源码，**不覆盖任何第三方书籍素材**。

## 数据与隐私

- `AppData`（书、词、笔记、复习日志、练习记录）存在 IndexedDB，localStorage 兜底
- 录音 Blob 单独存 `voice-audio` store，不进 JSON 备份，避免备份被音频撑爆
- 设置页可导出/恢复 JSON（不含音频）
- 设置页显示本机存储占用 / 配额（`navigator.storage.estimate()`），便于提前发现空间不足
- 学习记录同步为 **opt-in**：默认关闭不收集；开启前明确告知同步内容与用途，书籍文件不上传；离线先存本机队列、联网补传（[docs/learning-sync.md](docs/learning-sync.md)）
- **学习档案**：连接账号后在设置页展示云端汇总——已掌握词 / 收藏句子 / 跟读次数与准确率 / 活跃天数 / 薄弱词，让「上云」可见可感，明白 pathmora 在为你安排什么

## 已知限制

- 原生 STT 只有 Chrome / Edge 支持；其余浏览器需用本地 Whisper 或手动补写转写
- 首次启用 Whisper 需下载 40–80MB 模型（浏览器 Cache API 缓存，之后离线可用）
- AI 润色（三栏 original / corrected / idiomatic）**当前未接入**；实现保留在 `src/lib/polish.ts`，
  未在任何地方被引用。若要接入，请先做服务端代理，不要直接把 Key 放前端。
- Service Worker 安装时会按构建期清单（`precache-manifest.json`）预缓存全部懒加载 chunk，
  离线首次打开各页面可用；清单之外的资源仍需联网访问过一次才会进缓存
- 浏览器内生成句级定位单次音频 ≤ 16MB；EPUB 导入 >30MB 会二次确认、>60MB 拒绝
  （EPUB 会整份解包进内存），读取阶段显示真实进度，解析阶段显示状态文案
- 模型源默认 `hf-mirror.com`（首次下载需联网）；完全离线自托管请用 `local` 源
- 完整待办与优先级见 [`docs/audit-2026-11-07.md`](docs/audit-2026-11-07.md) 第 10 节

## 测试与 CI

```bash
npx playwright install chromium   # 仅首次
npm run typecheck                 # 源码 + 测试用例的类型检查
npm run test:unit                 # 纯函数单元测试（node:test，零额外依赖）
npm run test:e2e                  # 桌面 + 移动视口
```

`playwright.config.ts` 的 `webServer` 会先 `npm run build` 再跑 `vite preview` ——
Service Worker 只在生产构建下注册，离线 / 预缓存用例必须在 preview 环境跑。
GitHub Actions（`.github/workflows/ci.yml`）在 push / PR 时自动执行类型检查、单元测试与 E2E，失败会上传报告。

**单元测试**（`tests/unit/`，esbuild 编译 + `node:test` 执行）：词级 diff / 语速与口头禅指标 /
关键词提取、句级对齐的单调性与去重、备份条目级校验、按书隔离的音频时间轴查找。

**E2E 覆盖**：首页与 **7 项导航逐一点击渲染**（含懒加载的 Reader / 统计页）、
**缺本机书籍 JSON 的降级**、**非法备份与畸形条目的拒绝**（空 chapters 的书、缺 metrics 的练习记录）、
**SW 预缓存清单完整性**、**latin-ext 真实触发后的按需缓存**、**真实断网后离线首启与导航**，
以及**移动视口**（Pixel 7：底部导航 / 抽屉 / 阅读器无横向溢出）。
E2E 用独立端口 4173 的生产 preview，不会误复用开发者的 dev server。

## License

MIT — 仅覆盖原创源码。第三方素材与依赖见 `THIRD-PARTY-NOTICES.md`。
