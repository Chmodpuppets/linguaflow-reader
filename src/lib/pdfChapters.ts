import type { Chapter } from '../types';
import { breakLongParagraphs } from './sentence';

// 纯逻辑：把 PDF 逐页文本整理成章节/段落。不依赖 pdf.js，便于单测。

/** 章节标题识别：显式 chapter/part 等关键词，或独立编号行。保守以免把正文/页眉误判成标题。 */
export function isHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 70) return false;
  if (/^(chapter|part|book|prologue|epilogue|introduction|preface|foreword|conclusion|afterword)\b/i.test(trimmed)) return true;
  if (/^(第[一二三四五六七八九十百0-9]+[章节部卷回])/.test(trimmed)) return true;
  if (/^[0-9]{1,3}[.、]?\s+\S/.test(trimmed) && trimmed.split(/\s+/).length <= 8) return true;
  return false;
}

function isNoise(paragraph: string): boolean {
  const trimmed = paragraph.trim();
  return trimmed.length < 2 || /^\d+$/.test(trimmed);
}

/**
 * 把一段「行」还原成自然段：空行是明确的段落边界；段内硬换行拼接成整段，
 * 超长再按句拆。PDF 常用单换行硬换行，故不能简单「一行一段」。
 */
function linesToParagraphs(bodyLines: string[]): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length) {
      const joined = current.join(' ').trim();
      if (joined) paragraphs.push(...breakLongParagraphs([joined]));
      current = [];
    }
  };
  for (const line of bodyLines) {
    if (!line.trim()) flush();
    else current.push(line.trim());
  }
  flush();
  return paragraphs.filter((p) => !isNoise(p));
}

/** 逐行扫描：遇到标题行就开新章，其余行累积为正文。能识别页中/跨页的多个标题。 */
function byHeadings(lines: string[]): Chapter[] {
  const chapters: Chapter[] = [];
  let title = '';
  let body: string[] = [];
  const flush = () => {
    const paragraphs = linesToParagraphs(body);
    if (paragraphs.length) chapters.push({ id: `pdf-${chapters.length + 1}`, title: title || `Section ${chapters.length + 1}`, paragraphs });
    body = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { body.push(''); continue; }
    if (isHeading(line)) { flush(); title = line; }
    else body.push(line);
  }
  flush();
  return chapters;
}

/** 无标题时按页分组（每 ~12 页一个 Part），保证长 PDF 也有可导航的章节。 */
function byPageGroups(pageTexts: string[]): Chapter[] {
  const GROUP = 12;
  const chapters: Chapter[] = [];
  for (let start = 0; start < pageTexts.length; start += GROUP) {
    const slice = pageTexts.slice(start, start + GROUP);
    const paragraphs = linesToParagraphs(slice.flatMap((text) => text.split('\n')));
    if (paragraphs.length) chapters.push({ id: `pdf-${chapters.length + 1}`, title: `Part ${chapters.length + 1}`, paragraphs });
  }
  return chapters;
}

/** 纯函数：把逐页文本整理成章节。有标题按标题切，否则按页分组。 */
export function pdfPagesToChapters(pageTexts: string[]): Chapter[] {
  const lines = pageTexts.flatMap((text) => text.split('\n'));
  const hasHeading = lines.some((line) => isHeading(line));
  const chapters = hasHeading ? byHeadings(lines) : byPageGroups(pageTexts);
  return chapters.filter((chapter) => chapter.paragraphs.length > 0);
}
