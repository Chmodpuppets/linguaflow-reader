// ── 听写（dictation）判定 ─────────────────────────────────────────────────────
// 听写 = 听 TTS 读音，把单词拼写回来。判定宽容大小写 / 首尾空白 / 末尾标点，
// 但要求字母序列一致（连字符 / 撇号保留，如 don't / well-known）。

export function normalizeDictation(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[\s]+/g, ' ')
    .replace(/[.,!?;:"“”]+$/g, '')
    .trim();
}

export function dictationCorrect(target: string, answer: string): boolean {
  const t = normalizeDictation(target);
  const a = normalizeDictation(answer);
  return t.length > 0 && a === t;
}
