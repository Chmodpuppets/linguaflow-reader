// v11：install 读取构建期 precache-manifest.json，补齐所有懒加载 chunk，离线首启可用。
// v10：声明 esbuild 为显式 devDependency、修正过期注释，资源清单变化。
// v9：书籍正文外置为本机可选 JSON，不再打进 JS bundle，资源清单变化。
// v8：开源合规清理（dist 剔除版权素材、缺图降级、字体许可证随产物分发），资源清单变化。
// v7：新增「上传音频 → 本地 Whisper 时间戳 → 文本对齐」的运行时句级定位，资源清单变化。
// v6：新增「按书绑定用户原音」+ 对齐表拆为按需 chunk，资源清单变化，
//      必须换缓存名触发 install，否则老用户会一直拿引用旧 hash 的 index.html。
// v5：修复 fetch handler 拦截媒体 Range 请求导致音频 503 的问题；缓存只收 200 与白名单资源。
// 生产构建时 vite.config.ts 的 precacheManifest() 会把下面这行替换成基于产物哈希的缓存名；
// 这里的值只用于 dev / 直接阅读源码，不用手工维护。
const CACHE = 'linguaflow-reader-v11';
const SHELL = ['/', '/manifest.webmanifest', '/linguaflow-icon.png'];

// 本机版权素材（书籍扫描图 / 音频 / 正文 JSON）不随公开构建产物分发，
// 也不进 Cache Storage，避免撑爆配额。缓存只覆盖：应用外壳 + 构建产物 + wasm 运行时。
function cacheable(url) {
  const path = new URL(url).pathname;
  if (path.endsWith('.mp3') || path.includes('/audio')) return false;
  return path === '/' || path.startsWith('/assets/') || path.startsWith('/wasm/') || path.includes('/books/');
}
// 预缓存（install 管理，永不裁剪）与运行时缓存分开：
// 长期使用时 cache.put 会无限累积，单独设上限才不会撑爆配额。
const RUNTIME_CACHE = `${CACHE}-runtime`;
const MAX_RUNTIME_ENTRIES = 120;
let putsSinceTrim = 0;

async function trimRuntimeCache(cache) {
  putsSinceTrim += 1;
  if (putsSinceTrim < 20) return; // 每 20 次写入才列一次 keys，避免每个请求都扫全表
  putsSinceTrim = 0;
  const keys = await cache.keys();
  if (keys.length <= MAX_RUNTIME_ENTRIES) return;
  for (const key of keys.slice(0, keys.length - MAX_RUNTIME_ENTRIES)) await cache.delete(key);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    // 绕过 HTTP 缓存拿最新的 index.html，避免 install 时把上一版的资源清单又缓存一遍。
    const response = await fetch('/', { cache: 'reload' });
    const html = await response.text();
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
    // 构建期清单：React.lazy 的 chunk / worker / 字体都不在 index.html 里。
    // 不补齐它们，离线首次打开 Reader / VoiceLab 会直接落到 503。
    const manifest = await fetch('/precache-manifest.json', { cache: 'reload' })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    const precache = new Set([...assets, ...(Array.isArray(manifest?.assets) ? manifest.assets : [])]);
    for (const url of [...precache].filter((item) => item.endsWith('.css'))) {
      const css = await (await fetch(url)).text().catch(() => '');
      const fonts = [...css.matchAll(/url\((?:['"]?)([^)'"\s]+)/g)].map((match) => new URL(match[1], new URL(url, self.location.origin)).pathname);
      for (const font of fonts) precache.add(font);
    }
    // latin-ext 子集带 unicode-range，只在页面真出现变音字母时才会被请求。
    // 它既在构建清单里、也在 CSS 里，统一在这里过滤，避免白占约 127KB 配额；
    // 真用到时由 fetch handler 运行时按需缓存，多语言 EPUB 不受影响。
    const toCache = [...precache].filter((url) => !url.includes('latin-ext'));
    // 逐个 add 且允许失败：单个资源 404 不该让整个 SW 安装失败。
    await Promise.allSettled(toCache.map((url) => cache.add(url)));
  })());
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) return;
  // 媒体元素的 Range 请求返回 206，cache.put 不支持且会抛错；直接透传网络，
  // 拖进度条、seek 都依赖 Range，绝不能进缓存路径。
  if (event.request.headers.has('range')) return;
  // 只缓存白名单资源，音频等大文件放行网络，不缓存。
  if (!cacheable(event.request.url)) return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request, { ignoreVary: true });
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok && response.status === 200) {
        const cache = await caches.open(RUNTIME_CACHE);
        await cache.put(event.request, response.clone());
        await trimRuntimeCache(cache);
      }
      return response;
    } catch {
      if (event.request.mode === 'navigate') return caches.match('/', { ignoreVary: true });
      return new Response('当前离线，且这个资源还没被缓存。请联网打开过一次后再试。', { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
