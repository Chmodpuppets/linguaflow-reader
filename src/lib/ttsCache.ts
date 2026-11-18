/** TTS 音频的两级持久缓存，目标：同一 (文本,音色,模型) 绝不重复花上游 API 额度。
 *
 *  L2 本机 IndexedDB（db.ts tts-audio）：合成出的字节落盘，刷新/重启/换网络都 0 请求。
 *      本地优先、无需登录、永远可用；有界 LRU（条数 + 总体积）防止无限膨胀。
 *  L3 服务端 OSS 共享缓存（复用 linguaflow-server /tts/audio，内容寻址）：登录态下
 *      先 GET 命中别人/别的设备合成过的音频；合成后 POST 落 OSS，跨设备跨用户只合成一次。
 *      未登录或代理未启用时安静跳过，L2 仍保证本机不重复请求。
 *
 *  密钥始终不进这两层：合成在浏览器直连用户端点（qwenTts.ts），这里只缓存「结果音频」。
 *  所有函数在非浏览器/无 IDB/无网环境安静降级（返回 null / noop），不阻断发音。 */

import { clearTtsAudio, getTtsAudio, listTtsAudioMeta, saveTtsAudio, trimTtsAudio } from './db';
import { getDictionaryBase } from './remoteDictionary';

const AUTH_TOKEN_KEY = 'pathmora_auth_token';
const IDB_MAX_ENTRIES = 400;
const IDB_MAX_BYTES = 40 * 1024 * 1024; // 40MB，单句 ~20-60KB，可存数百句
const TRIM_EVERY = 25; // 每写 25 次裁一次，避免每次合成都全表扫描
let writesSinceTrim = 0;

function authToken(): string | null {
  try { return localStorage.getItem(AUTH_TOKEN_KEY); } catch { return null; }
}

/** 是否具备 OSS 共享缓存条件（有登录 token；代理是否启用由服务端 503 兜底）。 */
export function ossCacheReady(): boolean {
  return !!authToken();
}

// —— L2：本机 IndexedDB ——
export async function readDurableTts(key: string): Promise<Blob | null> {
  try { return await getTtsAudio(key); } catch { return null; }
}

export async function writeDurableTts(key: string, blob: Blob): Promise<void> {
  try {
    await saveTtsAudio(key, blob);
    writesSinceTrim += 1;
    if (writesSinceTrim >= TRIM_EVERY) {
      writesSinceTrim = 0;
      await trimTtsAudio(IDB_MAX_ENTRIES, IDB_MAX_BYTES);
    }
  } catch { /* 配额满/无 IDB：放弃持久化，不影响本次播放 */ }
}

/** 本机缓存概览（设置页展示用）：段数 / 总字节 / 是否具备 OSS 共享条件。无 IDB 时返回零值。 */
export async function ttsCacheStats(): Promise<{ count: number; bytes: number; ossReady: boolean }> {
  try {
    const meta = await listTtsAudioMeta();
    return { count: meta.length, bytes: meta.reduce((sum, m) => sum + m.size, 0), ossReady: ossCacheReady() };
  } catch {
    return { count: 0, bytes: 0, ossReady: ossCacheReady() };
  }
}

/** 清空本机持久缓存（不含会话 Map，调用方另清）。失败安静忽略。 */
export async function clearDurableTts(): Promise<void> {
  try { await clearTtsAudio(); } catch { /* ignore */ }
}

// —— L3：服务端 OSS 共享缓存（/tts/audio，鉴权 + 内容寻址 namespace）——
function authHeaders(): Record<string, string> {
  const token = authToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** GET 读共享缓存：200→音频 Blob；404(未合成)/503(未启用)/错误→null。 */
export async function ossLookupTts(text: string, voice: string, ns: string): Promise<Blob | null> {
  if (!ossCacheReady()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const url = `${getDictionaryBase()}/tts/audio?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voice)}&ns=${encodeURIComponent(ns)}`;
    const res = await fetch(url, { headers: authHeaders(), signal: controller.signal });
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.size ? blob : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface OssStorePayload {
  /** 上游音频 URL（仅阿里云 OSS/CDN，服务端白名单内代抓，解决浏览器 CORS）。 */
  src?: string;
  /** base64 音频（客户端已拿到字节时直接传）。 */
  data?: string;
  contentType?: string;
}

/** POST 落 OSS 并回流字节：200→音频 Blob（顺带拿到可持久化的字节）；失败→null。 */
export async function ossStoreTts(text: string, voice: string, ns: string, payload: OssStorePayload): Promise<Blob | null> {
  if (!ossCacheReady()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${getDictionaryBase()}/tts/audio`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, ns, ...payload }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.size ? blob : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Blob → 纯 base64（不含 data: 前缀），供 OSS POST 的 data 字段。分块避免大数组栈溢出。 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
