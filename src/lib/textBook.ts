import type { Book, Chapter } from '../types';

const ACCENTS = ['#7c5cff', '#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#ec4899'];

/** 把连续非空行合并为一个自然段（单换行视为同段），空行作为段落边界。 */
function blocksToParagraphs(lines: string[]): string[] {
  const paragraphs: string[] = [];
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join(' ').replace(/\s+/g, ' ').trim();
    if (text) paragraphs.push(text);
    buffer = [];
  };
  for (const line of lines) {
    if (line.trim()) buffer.push(line.trim());
    else flush();
  }
  flush();
  return paragraphs;
}

interface RawChapter { title: string; lines: string[] }

/** 优先按 Markdown 标题（# / ## / ###）或「第X章/Chapter N」分章；否则整体按段落数切块。 */
function splitChapters(text: string, fallbackTitle: string): RawChapter[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const heading = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
  const chapterLine = /^(第[0-9一二三四五六七八九十百]+[章节回]|chapter\s+[0-9ivxlc]+|part\s+[0-9ivxlc]+)\b/i;
  const chapters: RawChapter[] = [];
  let current: RawChapter | null = null;
  let sawHeading = false;
  for (const line of lines) {
    const match = line.match(heading) || (chapterLine.test(line.trim()) ? [line, '', line.trim()] : null);
    if (match) {
      sawHeading = true;
      current = { title: match[2].trim(), lines: [] };
      chapters.push(current);
    } else {
      if (!current) { current = { title: fallbackTitle, lines: [] }; chapters.push(current); }
      current.lines.push(line);
    }
  }
  if (!sawHeading && chapters.length === 1) {
    // 无标题的长文：按 ~12 段切块，避免单章过长。
    const paragraphs = blocksToParagraphs(chapters[0].lines);
    if (paragraphs.length > 18) {
      const chunks: RawChapter[] = [];
      for (let i = 0; i < paragraphs.length; i += 12) {
        chunks.push({ title: `${fallbackTitle} · ${Math.floor(i / 12) + 1}`, lines: paragraphs.slice(i, i + 12).join('\n\n').split('\n') });
      }
      return chunks;
    }
  }
  return chapters.filter((chapter) => chapter.lines.some((line) => line.trim()));
}

/** LingQ 式「导入任何文本」：粘贴文章 / .txt / .md → 可阅读、可注音、可统计的书。 */
export function buildBookFromText(title: string, author: string, text: string, id: string): Book {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('文本为空，没有可导入的内容');
  if (trimmed.length > 2_000_000) throw new Error('文本过大（>2MB），请拆分后导入');
  const cleanTitle = title.trim() || trimmed.split('\n')[0].replace(/^#+\s*/, '').slice(0, 60) || '未命名文章';
  const raw = splitChapters(trimmed, cleanTitle);
  const chapters: Chapter[] = raw.map((chapter, index) => ({
    id: `${id}-ch-${index}`,
    title: chapter.title || `Section ${index + 1}`,
    paragraphs: blocksToParagraphs(chapter.lines),
  })).filter((chapter) => chapter.paragraphs.length > 0);
  if (!chapters.length) throw new Error('未能从文本中提取出正文段落');
  return {
    id,
    title: cleanTitle,
    author: author.trim() || '未知作者',
    description: `导入的文本 · ${chapters.length} 个章节 · 约 ${chapters.reduce((n, c) => n + c.paragraphs.join(' ').split(/\s+/).length, 0)} 词`,
    cover: '',
    accent: ACCENTS[Math.abs(hash(id)) % ACCENTS.length],
    chapters,
    progress: 0,
    currentChapter: 0,
    currentParagraph: 0,
    addedAt: new Date().toISOString(),
    source: 'text',
  };
}

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) { h = (h << 5) - h + value.charCodeAt(i); h |= 0; }
  return h;
}
