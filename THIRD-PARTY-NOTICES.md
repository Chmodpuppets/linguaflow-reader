# Third-Party Notices

本文件说明 LinguaFlow Reader 用到的第三方开源依赖与第三方素材。
`LICENSE` 的 MIT 许可**只覆盖本仓库原创源码**，不覆盖下列任何第三方作品。

## 1. 开源依赖

版本与许可证字段于 2026-11-08 从本机 `node_modules/*/package.json` 实查，非推测。

| 依赖 | 实测版本 | 许可证 | 用途 |
|---|---|---|---|
| `react` / `react-dom` | 19.3.1 | MIT | UI 框架 |
| `vite` | 6.4.5 | MIT | 构建工具（devDependency） |
| `@vitejs/plugin-react` | 4.7.0 | MIT | 构建插件（devDependency） |
| `typescript` | 5.7.3 | Apache-2.0 | 类型检查（devDependency） |
| `@huggingface/transformers` (Transformers.js) | 4.3.2 | Apache-2.0 | 浏览器内本地 Whisper 推理 |
| `jszip` | 3.10.2 | `MIT OR GPL-3.0-or-later` | EPUB 解包；本项目按 MIT 条款使用 |
| `lucide-react` | 0.468.0 | ISC | 图标 |
| `@fontsource-variable/inter` | 5.3.0 | **OFL-1.1** | UI 字体 |
| `@fontsource-variable/literata` | 5.3.0 | **OFL-1.1** | 正文字体 |

### 字体（SIL Open Font License 1.1）

`src/fonts.css` 只引用 Inter / Literata 的 latin 与 latin-ext 可变 woff2 子集，
这些字体文件会随 `dist/` 分发。OFL-1.1 要求随字体副本附上许可全文，因此全文已放在
`public/licenses/Inter-OFL.txt` 与 `public/licenses/Literata-OFL.txt`，构建时一并复制进 `dist/licenses/`。
字体名称不得被用于衍生字体的命名，字体本身不得单独出售 —— 详见两份许可全文。

### 传递依赖（未在 `package.json` 显式声明）

`onnxruntime-web`（实测 `1.31.0-dev.20260914-...`，MIT）与 `onnxruntime-common`（1.30.0，MIT）
是 `@huggingface/transformers` 的传递依赖，`scripts/copy-ort-assets.mjs` 会直接读取
`node_modules/onnxruntime-web/dist/` 里的两个 wasm 文件并复制到 `public/wasm/`。

> ⚠️ 该版本是 **dev 预发布构建**，且未被显式锁定。升级依赖时应先确认
> `ort-wasm-simd-threaded.{mjs,wasm}` 文件名未变化，否则 `copy-ort-assets.mjs` 会静默失败。

### 模型权重（不随仓库分发）

本地 Whisper 使用 `Xenova/whisper-tiny.en` / `base.en` 等模型，由 Hugging Face
（或 `hf-mirror.com` 镜像 / 自托管 `/models/`）在**用户首次启用时**下载并缓存在浏览器，
受各模型卡所列许可约束。本仓库**不打包任何模型权重**，`public/models/` 已被 `.gitignore` 排除。

## 2. 第三方书籍素材（不属于 MIT 授权范围）

内置示例《Diary of a Wimpy Kid》(Jeff Kinney) 的以下内容属于第三方版权材料：

| 内容 | 位置 | 当前状态 |
|---|---|---|
| 226 张页面扫描图 | `public/books/wimpy-kid/` | ✅ 已移出 git 索引、已 `.gitignore`、**本机文件保留** |
| 有声书音频（约 128MB） | `public/books/wimpy-kid/audio.mp3` | ✅ 同上 |
| QA 截图 / 测试样本（可能拍到书页） | `qa/` | ✅ 同上 |
| 226 页 OCR 全文 | `src/data/wimpyKidBook.ts` | ✅ 已移出索引 + `.gitignore`，本机保留为导出源 |
| 3161 行书文本 + 时间戳 | `src/data/wimpyKidAudioMap.ts` | ✅ 同上（原本未提交） |
| 上述数据导出的本机 JSON | `public/local-content/*.json` | ✅ `.gitignore` + 构建时从 `dist` 剔除 |

`public/books/`、`qa/` 与 `public/local-content/` 仅供本机开发放置合法获得的副本。
Vite 会把 `publicDir` 原样复制进 `dist/`，因此 `vite.config.ts` 的 `dropLocalBookAssets()`
会在构建收尾剔除 `dist/books/` 下的图片音频**与** `dist/local-content/*.json`
（实测 dist 从 154MB 降到 15MB）；本机构建需保留时设 `KEEP_LOCAL_ASSETS=1`。

书籍正文不再打进 JS bundle：`builtinBooks.ts` / `audioAlign.ts` 改为运行时 `fetch`
本机 JSON，文件缺失时安静降级为 3 本轻量样书、句级定位回退整段播放。
**默认构建产物不含扫描图、音频、书籍正文或时间戳，也不含任何引用它们的 JS chunk，
可安全公开部署。** 生成方式见 README「在本机启用内置扫描书」。

## 3. 开源状态（2026-11-09 已完成）

1. ✅ **书籍衍生文本外置**：两个数据文件只在本机、已 gitignore；
   `wimpyKidBook-*.js`（365KB）与 `wimpyKidAudioMap-*.js`（182KB）两个含全文的 chunk 已消失；
   实测 `dist/assets/*.js` 中搜不到书籍正文。缺本机 JSON 时应用优雅降级（13 项单测通过）。
2. ✅ **git 历史已隔离**：含版权内容的原仓库（`cb8fdba`）已改名为
   `Chmodpuppets/linguaflow-reader-legacy` 并保持 **private**；本仓库是同名新建的公开仓，
   **从第一个 commit 起就没有任何第三方书籍素材**。`main` 只有 1 个 commit、58 个文件、约 0.92MB。
3. 上线前对远端做了逐文件内容扫描：53 个文本文件 **0 命中书籍正文、0 禁用路径**，
   二进制只有两个自有品牌 LOGO。过程与命令见 `docs/PREPARE-PUBLIC.md`。

排查与优先级依据见 [`docs/audit-2026-11-07.md`](docs/audit-2026-11-07.md)。
