import { getDictionaryBase } from './remoteDictionary';

// ── 整句机器翻译客户端 ─────────────────────────────────────────────────────────
// 阅读时「整句看不懂」的轻量 MT 兜底。与查词同样的降级哲学：
//   ① 共享服务器 /translate（代理 MyMemory，服务端限流 + 缓存）优先；
//   ② 服务器不可达时直连免费 MyMemory API 二次兜底；
//   ③ 离线 / 超时 / 被墙都安静返回 null，调用方显示「暂无法翻译」，不阻塞阅读。
// MT 质量有限，仅作理解辅助，不替代词典释义。完全可选、不上传书籍。

export interface TranslateResult { text: string; source: 'server' | 'free' }

const cache = new Map<string, TranslateResult | null>();
const MAX_LEN = 1000;

function cacheKey(text: string, from: string, to: string): string {
  return `${from}|${to}|${text.trim().toLowerCase()}`;
}

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) return null;
  return response.json();
}

/** 整句翻译：服务器优先 → MyMemory 兜底。带内存缓存与超时；任何失败返回 null（不抛错）。 */
export async function translateSentence(text: string, from = 'en', to = 'zh'): Promise<TranslateResult | null> {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_LEN) return null;
  const key = cacheKey(trimmed, from, to);
  if (cache.has(key)) return cache.get(key) ?? null;
  if (typeof fetch === 'undefined' || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    cache.set(key, null);
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    // ① 共享服务器
    try {
      const data = (await getJson(`${getDictionaryBase()}/translate?q=${encodeURIComponent(trimmed)}&from=${from}&to=${to}`, controller.signal)) as { ok?: boolean; text?: string } | null;
      if (data?.ok && data.text) { const result: TranslateResult = { text: data.text, source: 'server' }; cache.set(key, result); return result; }
    } catch { /* 服务器不可达 → 二次兜底 */ }
    // ② 直连 MyMemory
    try {
      const langpair = `${from === 'en' ? 'en-GB' : from}|${to === 'zh' ? 'zh-CN' : to}`;
      const data = (await getJson(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=${encodeURIComponent(langpair)}`, controller.signal)) as { responseData?: { translatedText?: string } } | null;
      const translated = String(data?.responseData?.translatedText || '').trim();
      if (translated && !/MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGUAGE/i.test(translated)) {
        const result: TranslateResult = { text: translated, source: 'free' };
        cache.set(key, result);
        return result;
      }
    } catch { /* 忽略，回退 null */ }
    cache.set(key, null);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
