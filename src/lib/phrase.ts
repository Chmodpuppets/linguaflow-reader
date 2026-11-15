// ── 短语 / 习语收藏 ─────────────────────────────────────────────────────────────
// LingQ 式多词短语：划选两个及以上单词时，把整个短语（而不是折叠成单个词）存进词汇本，
// 带上用户自填的释义与所在原句。纯函数，便于单测与三产品复用。

/** 折叠空白并修剪，得到规范化的短语文本（保留原大小写）。 */
export function cleanPhrase(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 统计（空白分隔的）词数。 */
export function wordCount(text: string): number {
  const cleaned = cleanPhrase(text);
  return cleaned ? cleaned.split(' ').length : 0;
}

/** 是否为多词短语（≥2 个词）。 */
export function isMultiWord(text: string): boolean {
  return wordCount(text) >= 2;
}

/** 去重 / 比较用的小写键。 */
export function phraseKey(text: string): string {
  return cleanPhrase(text).toLowerCase();
}

/**
 * 复习挖空判定：把答案与目标都归一化（小写、去非字母/撇号/连字符字符，含空格），
 * 使多词短语 "give up" 与手写 "give up"/"Give Up!" 能正确匹配。
 */
export function normalizeForCompare(text: string): string {
  return text.toLowerCase().replace(/[^a-z'-]/g, '');
}
