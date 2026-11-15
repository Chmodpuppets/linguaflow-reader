import type { SavedSentence, VocabEntry } from '../types';
import { escapeRegExp } from './sentence';

// ── 句子挖掘导出（Anki / CSV） ────────────────────────────────────────────────
// 把「语境词汇 + 收藏句子」导出成可被 Anki / Excel / 其他 SRS 直接导入的卡片。
// 每张卡 = 一个词 + 它出现过的那句话 + 释义 + 音标 + 来源。纯函数，便于单测。

export interface ExportCard {
  word: string;
  sentence: string;
  meaning: string;
  phonetic: string;
  source: string;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 在句子里把目标词整词加粗（HTML），先转义防注入。 */
export function highlightWordHtml(sentence: string, word: string): string {
  const safe = escapeHtml(sentence);
  if (!word) return safe;
  const re = new RegExp(`\\b(${escapeRegExp(escapeHtml(word))})\\b`, 'gi');
  return safe.replace(re, '<b>$1</b>');
}

export function cardsFromVocab(entries: VocabEntry[]): ExportCard[] {
  return entries.map((entry) => ({
    word: entry.word,
    sentence: entry.context,
    meaning: entry.dictionary?.chinese || entry.dictionary?.meaning || '',
    phonetic: entry.dictionary?.phonetic || '',
    source: `${entry.bookTitle} · ${entry.chapterTitle}`,
  }));
}

export function cardsFromSentences(sentences: SavedSentence[]): ExportCard[] {
  return sentences.map((sentence) => ({
    word: sentence.word,
    sentence: sentence.text,
    meaning: sentence.meaning || '',
    phonetic: sentence.phonetic || '',
    source: `${sentence.bookTitle} · ${sentence.chapterTitle}`,
  }));
}

/** 合并并按「词 + 句」去重，保持先后顺序。 */
export function mergeCards(vocab: ExportCard[], sentences: ExportCard[]): ExportCard[] {
  const seen = new Set<string>();
  const out: ExportCard[] = [];
  for (const card of [...vocab, ...sentences]) {
    const key = `${card.word.toLowerCase()}::${card.sentence.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(card);
  }
  return out;
}

/** TSV 字段里不能有制表符 / 换行，统一压成空格。 */
function tsvField(value: string): string {
  return value.replace(/[\t\r\n]+/g, ' ').trim();
}

/** Anki 文本导入格式：带指令头 + HTML 字段。正面=加粗词句，背面=词/音标/释义/来源。 */
export function toAnkiTsv(cards: ExportCard[]): string {
  const lines = ['#separator:tab', '#html:true', '#notetype:Basic', '#deck:LinguaFlow'];
  for (const card of cards) {
    const front = tsvField(highlightWordHtml(card.sentence, card.word));
    const backParts = [
      `<b>${escapeHtml(card.word)}</b>`,
      card.phonetic ? escapeHtml(card.phonetic) : '',
      card.meaning ? escapeHtml(card.meaning) : '',
      card.source ? `<i>${escapeHtml(card.source)}</i>` : '',
    ].filter(Boolean);
    const back = tsvField(backParts.join('<br>'));
    lines.push(`${front}\t${back}`);
  }
  return lines.join('\n') + '\n';
}

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** 通用 CSV（无 HTML），首行表头，供 Excel / 其他工具。 */
export function toCsv(cards: ExportCard[]): string {
  const rows = [['Word', 'Sentence', 'Meaning', 'Phonetic', 'Source'].join(',')];
  for (const card of cards) {
    rows.push([card.word, card.sentence, card.meaning, card.phonetic, card.source].map(csvField).join(','));
  }
  return rows.join('\r\n') + '\r\n';
}
