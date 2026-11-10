<p align="center">
  <img src="public/linguaflow-logo.png" width="320" alt="LinguaFlow">
</p>

# LinguaFlow Reader

一个把「读」和「说」接起来的本地优先阅读器。读完一句，就地跟读；说完一段，立刻看到差距。

纯前端，无后端、无账号。书 / 词 / 笔记 / 录音全部留在本机 IndexedDB，不上传。
唯一需要联网的环节是**首次启用本地 Whisper 时下载模型**（默认 `hf-mirror.com`，可切到自托管 `/models/` 完全离线）；转写推理本身在浏览器本地完成。

## 功能模块

导航共 7 项：书库（点开书进入阅读器）、词汇本、复习、口语实验室、声波与成长统计、笔记、设置。
下面按三条主线介绍核心能力。

**阅读器**
- EPUB 导入（JSZip + DOMParser）与内置样书
- 扫描书模式：原图 + OCR 文字层，点图上单词即可查义
- 轻点查词、划选标记、目录抽屉、字号/行高/主题、键盘翻页
- 有声书页码锚点（AudioBar 与章节对齐，刷新后保持）

**口语实验室**
- 三种模式：原句跟读 Shadowing / 盲听复述 Cloze Retell（隐藏原文 + 关键词脚手架 + 60s 上限）/ 自由独白 Free Talk（到期词说出口即点亮）
- MediaRecorder 录音 + Web Audio 波形；有原音时显示原音声波，无原音时为静态占位基线并切换系统 TTS 示范
- 转写双引擎：浏览器原生实时识别，或**本地 Whisper**（离线、标点更准、Safari/Firefox 可用）
- Levenshtein 词级 diff（🟢 匹配 / 🟡 低置信 / 🔴 漏读替换）、净语速 WPM、卡顿占比、口头禅统计
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

设置页 →「有声书原音」可为**书库里任意一本书**（含自己导入的 EPUB）绑定本机音频文件
（mp3 / m4a / wav / ogg 等）。音频 Blob 存在 IndexedDB 的 `book-audio` store，按 `bookId` 索引：

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
npm run typecheck                 # 源码 + E2E 用例的类型检查
npm run test:e2e
```

`playwright.config.ts` 的 `webServer` 会先 `npm run build` 再跑 `vite preview` ——
Service Worker 只在生产构建下注册，离线 / 预缓存用例必须在 preview 环境跑。
GitHub Actions（`.github/workflows/ci.yml`）在 push / PR 时自动执行类型检查与 E2E，失败会上传报告。

用例覆盖：首页与 7 项导航、**缺本机书籍 JSON 的降级**、**非法备份恢复的 toast 提示**、
**SW 预缓存清单完整性**与 **latin-ext 按需缓存**（这几项此前只有静态验证）。

## License

MIT — 仅覆盖原创源码。第三方素材与依赖见 `THIRD-PARTY-NOTICES.md`。
