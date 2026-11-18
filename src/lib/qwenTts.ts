/** Qwen TTS（用户自带 API）：两种接入协议，作为浏览器 TTS 的高质量兜底。
 *  ① dashscope —— 阿里云百炼官方多模态生成端点（qwen3-tts-flash，多语种）。
 *  ② openai    —— OpenAI 兼容 /audio/speech（可接硅基流动等第三方或自建）。
 *  密钥仅保存在本设备（随设置/备份），合成在浏览器直连用户填写的端点；失败安静返回 null，由上层回退浏览器 TTS。
 *  合成结果按 (文本,音色,模型) 持久缓存：本机 IndexedDB 永远兜底，登录态再叠服务端 OSS 共享缓存，绝不重复花额度。 */

import { readDurableTts, writeDurableTts, ossCacheReady, ossLookupTts, ossStoreTts, blobToBase64 } from './ttsCache';

export type TtsProvider = 'off' | 'dashscope' | 'openai';

export interface DashscopeTtsConfig {
  apiKey: string;
  /** 默认官方 host；填 compatible-mode 地址会自动推导回原生 host。 */
  baseUrl: string;
  model: string;
  voice: string;
}

export interface OpenaiTtsConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  voice: string;
}

export interface TtsConfig {
  provider: TtsProvider;
  dashscope: DashscopeTtsConfig;
  openai: OpenaiTtsConfig;
}

/** qwen3-tts-flash 常见音色（仅作建议，用户可自由填写账号支持的其它音色）。 */
export const DASHSCOPE_VOICES = ['Cherry', 'Jennifer', 'Serena', 'Ethan', 'Chelsie', 'Dylan', 'Jada', 'Sunny', 'Katerina'];
/** OpenAI 兼容端点常见音色（第三方如 CosyVoice 音色不同，可自由填写）。 */
export const OPENAI_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

export const DEFAULT_DASHSCOPE_HOST = 'https://dashscope.aliyuncs.com';

export function defaultTtsConfig(): TtsConfig {
  return {
    provider: 'off',
    dashscope: { apiKey: '', baseUrl: DEFAULT_DASHSCOPE_HOST, model: 'qwen3-tts-flash', voice: 'Cherry' },
    openai: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts', voice: 'alloy' },
  };
}

/** 是否已配置可用 TTS（选了协议且填了必要凭据）。 */
export function isTtsConfigured(config: TtsConfig | null | undefined): boolean {
  if (!config || config.provider === 'off') return false;
  if (config.provider === 'dashscope') return config.dashscope.apiKey.trim().length > 0;
  return config.openai.apiKey.trim().length > 0 && config.openai.baseUrl.trim().length > 0;
}

/** 把用户填的 base URL 推导成 DashScope 原生 host（去掉 /compatible-mode/v1 与末尾斜杠）。 */
export function dashscopeHost(baseUrl: string): string {
  const trimmed = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_DASHSCOPE_HOST;
  return trimmed.replace(/\/compatible-mode\/v1$/, '') || DEFAULT_DASHSCOPE_HOST;
}

/** L1 会话内缓存：同协议+音色+文本只合成一次（最快，免异步读盘）。blob URL 逐出时回收。 */
const urlCache = new Map<string, string>();
const CACHE_LIMIT = 200;

export function ttsCacheKey(config: TtsConfig, text: string): string {
  return config.provider === 'dashscope'
    ? `ds|${config.dashscope.model}|${config.dashscope.voice}|${text}`
    : `oa|${config.openai.baseUrl}|${config.openai.model}|${config.openai.voice}|${text}`;
}

/** OSS 共享缓存的内容寻址命名空间：区分协议+模型（+OpenAI 端点 host），避免不同链路同音色撞键。 */
export function ttsNamespace(config: TtsConfig): string {
  if (config.provider === 'dashscope') {
    return `r1ds|${config.dashscope.model.trim() || 'qwen3-tts-flash'}`.slice(0, 64);
  }
  let host = config.openai.baseUrl.trim();
  try { host = new URL(host).host; } catch { /* 非法定 URL：原样作区分 */ }
  return `r1oa|${config.openai.model.trim() || 'gpt-4o-mini-tts'}|${host}`.slice(0, 64);
}

function ttsVoice(config: TtsConfig): string {
  return (config.provider === 'dashscope' ? config.dashscope.voice : config.openai.voice).trim();
}

function remember(key: string, url: string): void {
  urlCache.set(key, url);
  if (urlCache.size > CACHE_LIMIT) {
    const oldest = urlCache.keys().next().value;
    if (oldest !== undefined) {
      const old = urlCache.get(oldest);
      if (old && old.startsWith('blob:')) URL.revokeObjectURL(old);
      urlCache.delete(oldest);
    }
  }
}

/** 清空会话缓存（设置变更时调用）。持久层按内容键含配置，旧配置条目自然不再命中，由有界淘汰回收。 */
export function clearTtsCache(): void {
  for (const url of urlCache.values()) if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  urlCache.clear();
}

const TTS_TIMEOUT_MS = 20000;

function base64ToBlob(b64: string, contentType: string): Blob {
  const clean = b64.replace(/^data:[^,]*,/, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
}

/** fire-and-forget 把字节落本机 IDB + 服务端 OSS（登录态）。不阻塞播放，失败安静。 */
function persistBlob(key: string, text: string, voice: string, ns: string, blob: Blob): void {
  void writeDurableTts(key, blob);
  if (!ossCacheReady()) return;
  void (async () => {
    try {
      const data = await blobToBase64(blob);
      await ossStoreTts(text, voice, ns, { data, contentType: blob.type || 'audio/mpeg' });
    } catch { /* 落盘失败下次再来 */ }
  })();
}

/** 合成语音，返回可播放 URL（http(s)/data/blob）。三级缓存命中即 0 上游请求；未配置/失败/超时/空→null（上层回退浏览器 TTS）。 */
export async function synthesizeTts(text: string, config: TtsConfig): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed || !isTtsConfigured(config)) return null;
  const key = ttsCacheKey(config, trimmed);
  const sessionHit = urlCache.get(key);
  if (sessionHit) return sessionHit;

  // L2 本机持久缓存：刷新/重启后直接复用，0 请求。
  const durable = await readDurableTts(key);
  if (durable) {
    const url = URL.createObjectURL(durable);
    remember(key, url);
    return url;
  }

  const ns = ttsNamespace(config);
  const voice = ttsVoice(config);
  // L3 OSS 共享缓存：登录态下复用别的设备/用户合成过的音频。
  const shared = await ossLookupTts(trimmed, voice, ns);
  if (shared) {
    const url = URL.createObjectURL(shared);
    remember(key, url);
    void writeDurableTts(key, shared);
    return url;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);
  try {
    if (config.provider === 'dashscope') {
      const res = await fetch(`${dashscopeHost(config.dashscope.baseUrl)}/api/v1/services/aigc/multimodal-generation/generation`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.dashscope.apiKey.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.dashscope.model.trim() || 'qwen3-tts-flash',
          input: { text: trimmed, voice: voice || 'Cherry' },
        }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) return null;
      const remote = data?.output?.audio?.url;
      const b64 = data?.output?.audio?.data;
      if (b64) {
        // base64：客户端已有字节，data URL 直接可播；同时落 IDB + OSS。
        const dataUrl = `data:audio/wav;base64,${String(b64).replace(/^data:[^,]*,/, '')}`;
        remember(key, dataUrl);
        try { persistBlob(key, trimmed, voice, ns, base64ToBlob(String(b64), 'audio/wav')); } catch { /* 解码失败仍可播 data URL */ }
        return dataUrl;
      }
      if (remote) {
        const remoteUrl = String(remote);
        // 上游 CDN 无 CORS，浏览器抓不到字节；登录态经服务端代抓并落 OSS，顺带拿回字节持久化。
        if (ossCacheReady()) {
          const blob = await ossStoreTts(trimmed, voice, ns, { src: remoteUrl });
          if (blob) {
            const url = URL.createObjectURL(blob);
            remember(key, url);
            void writeDurableTts(key, blob);
            return url;
          }
        }
        // 未登录/代理失败：直接播临时 URL（无法取字节持久化），仅会话缓存。
        remember(key, remoteUrl);
        return remoteUrl;
      }
      return null;
    }
    const base = config.openai.baseUrl.trim().replace(/\/+$/, '');
    const res = await fetch(`${base}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openai.apiKey.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.openai.model.trim() || 'gpt-4o-mini-tts',
        input: trimmed,
        voice: voice || 'alloy',
        response_format: 'mp3',
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size) return null;
    const url = URL.createObjectURL(blob);
    remember(key, url);
    persistBlob(key, trimmed, voice, ns, blob);
    return url;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
