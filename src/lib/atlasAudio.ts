/** Word Atlas 发音播放：优先真人录音（自有 OSS），无媒体或加载失败时回退浏览器 TTS，保证始终能发音。
 *  供查词面板主发音按钮、AtlasCard 英美发音按钮、词汇本与复习的单词发音共用，行为一致。 */
import { atlasMediaUrls, lookupAtlas, type AtlasWord } from './wordAtlas';

let currentAudio: HTMLAudioElement | null = null;

function stopCurrentAudio(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

/** 浏览器 TTS 兜底朗读（无录音可用时）。 */
export function speakText(text: string, rate = 0.95): void {
  stopCurrentAudio();
  if (typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = rate;
  speechSynthesis.speak(u);
}

/** 有录音 URL 就播真人录音（失败回退 TTS）；没有则直接 TTS。切换发音时停掉上一段，避免叠音。 */
export function playAtlasAudio(url: string | undefined, text: string): void {
  stopCurrentAudio();
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  if (url) {
    const audio = new Audio(url);
    currentAudio = audio;
    // 仅当这段音频仍是当前播放时才回退 TTS，避免快速切词后旧音频的失败回调误发声。
    const fallback = () => { if (currentAudio === audio) speakText(text); };
    audio.play().catch(fallback);
    audio.addEventListener('error', fallback, { once: true });
    return;
  }
  speakText(text);
}

/** 从词条取真人录音 URL（美式优先→英式）；无录音返回 undefined。纯函数便于单测。 */
export function pickWordRecordingUrl(entry: AtlasWord | null): string | undefined {
  if (!entry) return undefined;
  const media = atlasMediaUrls(entry.id, entry.media);
  return media.us || media.uk;
}

/** 单词自然发音：词库有真人录音就播录音，否则浏览器 TTS。
 *  slow=true（听写慢放）直接用慢速 TTS——真人录音无法变速。词库不可达/离线时安静回退 TTS。 */
export async function speakWordNatural(word: string, opts?: { slow?: boolean }): Promise<void> {
  if (opts?.slow) { speakText(word, 0.55); return; }
  let url: string | undefined;
  try { url = pickWordRecordingUrl(await lookupAtlas(word)); } catch { url = undefined; }
  playAtlasAudio(url, word);
}
