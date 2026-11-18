/** Qwen TTS（用户自带 API）：两种接入协议，作为浏览器 TTS 的高质量兜底。
 *  ① dashscope —— 阿里云百炼官方多模态生成端点（qwen3-tts-flash，多语种）。
 *  ② openai    —— OpenAI 兼容 /audio/speech（可接硅基流动等第三方或自建）。
 *  密钥仅保存在本设备（随设置/备份），合成在浏览器直连用户填写的端点；失败安静返回 null，由上层回退浏览器 TTS。 */

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

/** 会话内缓存：同协议+音色+文本只合成一次。OpenAI 返回 blob object URL，逐出时回收。 */
const urlCache = new Map<string, string>();
const CACHE_LIMIT = 200;

export function ttsCacheKey(config: TtsConfig, text: string): string {
  return config.provider === 'dashscope'
    ? `ds|${config.dashscope.model}|${config.dashscope.voice}|${text}`
    : `oa|${config.openai.baseUrl}|${config.openai.model}|${config.openai.voice}|${text}`;
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

/** 清空会话缓存（设置变更时调用，避免用旧音色/旧端点的缓存）。 */
export function clearTtsCache(): void {
  for (const url of urlCache.values()) if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  urlCache.clear();
}

const TTS_TIMEOUT_MS = 20000;

/** 合成语音，返回可播放 URL（http(s) / data / blob）。未配置、失败、超时、空响应一律返回 null（上层回退浏览器 TTS）。 */
export async function synthesizeTts(text: string, config: TtsConfig): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed || !isTtsConfigured(config)) return null;
  const key = ttsCacheKey(config, trimmed);
  const hit = urlCache.get(key);
  if (hit) return hit;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);
  try {
    let url: string | null = null;
    if (config.provider === 'dashscope') {
      const res = await fetch(`${dashscopeHost(config.dashscope.baseUrl)}/api/v1/services/aigc/multimodal-generation/generation`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.dashscope.apiKey.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.dashscope.model.trim() || 'qwen3-tts-flash',
          input: { text: trimmed, voice: config.dashscope.voice.trim() || 'Cherry' },
        }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) return null;
      const remote = data?.output?.audio?.url;
      const b64 = data?.output?.audio?.data;
      url = remote ? String(remote) : b64 ? `data:audio/wav;base64,${b64}` : null;
    } else {
      const base = config.openai.baseUrl.trim().replace(/\/+$/, '');
      const res = await fetch(`${base}/audio/speech`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.openai.apiKey.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.openai.model.trim() || 'gpt-4o-mini-tts',
          input: trimmed,
          voice: config.openai.voice.trim() || 'alloy',
          response_format: 'mp3',
        }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (!blob.size) return null;
      url = URL.createObjectURL(blob);
    }
    if (url) remember(key, url);
    return url;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
