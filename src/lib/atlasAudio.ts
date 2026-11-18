/** Word Atlas 发音播放：优先真人录音（自有 OSS），无媒体或加载失败时回退浏览器 TTS，保证始终能发音。
 *  供查词面板主发音按钮与 AtlasCard 英美发音按钮共用，行为一致。 */

/** 浏览器 TTS 兜底朗读（无录音可用时）。 */
export function speakText(text: string): void {
  if (typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.95;
  speechSynthesis.speak(u);
}

/** 有录音 URL 就播真人录音（失败回退 TTS）；没有则直接 TTS。 */
export function playAtlasAudio(url: string | undefined, text: string): void {
  if (url) {
    const audio = new Audio(url);
    audio.play().catch(() => speakText(text));
    audio.addEventListener('error', () => speakText(text), { once: true });
    return;
  }
  speakText(text);
}
