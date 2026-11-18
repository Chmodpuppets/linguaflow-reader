/** 中央朗读引擎：所有「无真人录音时」的朗读统一走这里。
 *  优先用户配置的 Qwen TTS（高质量），未配置/失败/慢速时安静回退浏览器 speechSynthesis。
 *  用递增序号守卫异步合成：快速切词/句时，旧的合成结果不会误发声或误触发回调。 */
import { isTtsConfigured, synthesizeTts, type TtsConfig } from './qwenTts';

let config: TtsConfig | null = null;
let currentAudio: HTMLAudioElement | null = null;
let currentUtterance: SpeechSynthesisUtterance | null = null;
let seq = 0;

/** App 根据设置注册当前 TTS 配置（null/未配置 → 纯浏览器 TTS）。 */
export function setTtsConfig(next: TtsConfig | null): void {
  config = next;
}

export interface SpeakOpts {
  rate?: number;
  lang?: string;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: () => void;
}

/** 停止一切朗读（Qwen 音频 + 浏览器 TTS），并使在途合成失效。 */
export function stopSpeech(): void {
  seq += 1;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  currentUtterance = null;
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}

function browserSpeak(text: string, opts: SpeakOpts, generation: number): void {
  if (typeof speechSynthesis === 'undefined') {
    if (seq === generation) { opts.onError?.(); opts.onEnd?.(); }
    return;
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = opts.lang || 'en-US';
  utterance.rate = opts.rate ?? 0.95;
  currentUtterance = utterance;
  utterance.onstart = () => { if (seq === generation) opts.onStart?.(); };
  utterance.onend = () => {
    if (currentUtterance === utterance) currentUtterance = null;
    if (seq === generation) opts.onEnd?.();
  };
  utterance.onerror = () => {
    if (currentUtterance === utterance) currentUtterance = null;
    if (seq === generation) { opts.onError?.(); opts.onEnd?.(); }
  };
  speechSynthesis.speak(utterance);
}

/** 朗读文本：Qwen TTS 优先（已配置且非慢速），否则浏览器 TTS。fire-and-forget，回调用于状态跟踪。 */
export function speak(text: string, opts: SpeakOpts = {}): void {
  stopSpeech();
  const generation = seq;
  const rate = opts.rate ?? 0.95;
  // 慢速（听写/跟读慢放）Qwen 不易变速，直接用浏览器 TTS；未配置 likewise。
  if (rate < 0.9 || !isTtsConfigured(config)) {
    browserSpeak(text, opts, generation);
    return;
  }
  void (async () => {
    let url: string | null = null;
    try { url = await synthesizeTts(text, config as TtsConfig); } catch { url = null; }
    if (seq !== generation) return; // 已被新的朗读取代
    if (!url) { browserSpeak(text, opts, generation); return; }
    const audio = new Audio(url);
    currentAudio = audio;
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (currentAudio === audio) currentAudio = null;
      if (seq !== generation) return;
      if (!ok) { browserSpeak(text, opts, generation); return; }
      opts.onEnd?.();
    };
    audio.addEventListener('ended', () => finish(true), { once: true });
    audio.addEventListener('error', () => finish(false), { once: true });
    opts.onStart?.();
    audio.play().catch(() => finish(false));
  })();
}
