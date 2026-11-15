import type { Book } from '../types';
import { makeId } from './utils';
import { pdfPagesToChapters } from './pdfChapters';
import type { ImportProgress } from './epub';
// Vite 会把 worker 作为独立资源产出并给出 URL；pdf.js 在 worker 里解析，不阻塞主线程。
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

const ACCENTS = ['#0ea5e9', '#7c5cff', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

/** 导入 PDF：pdf.js 逐页提取文字层 → 章节/段落。扫描版（无文字）给出明确提示。 */
export async function importPdf(file: File, onProgress?: (progress: ImportProgress) => void): Promise<Book> {
  onProgress?.({ phase: 'reading', progress: 0, label: '准备读取 PDF…' });
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const data = await file.arrayBuffer();
  // 自托管标准字体数据 + CMap（scripts/copy-pdf-assets.mjs 复制到 public/pdfjs/），
  // 让标准 14 字体与中文 CID 字体的 PDF 也能离线提取文字。
  const loadingTask = pdfjs.getDocument({
    data,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
  });
  const doc = await loadingTask.promise;
  const numPages = doc.numPages;
  const pageTexts: string[] = [];
  let totalChars = 0;
  try {
    for (let i = 1; i <= numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if ('str' in item) {
          text += item.str;
          if (item.hasEOL) text += '\n';
        }
      }
      pageTexts.push(text);
      totalChars += text.replace(/\s/g, '').length;
      onProgress?.({ phase: 'reading', progress: Math.round((i / numPages) * 100), label: `提取第 ${i}/${numPages} 页…` });
    }
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
  // 扫描图片版 PDF 没有文字层，提取结果≈0；阈值放低以免误伤短篇但有效的 PDF。
  if (totalChars < 20) {
    throw new Error('这个 PDF 没有可提取的文字（可能是扫描图片版）。请改用带文字层的 PDF，或导入 EPUB / 文本。');
  }
  onProgress?.({ phase: 'parsing', progress: 100, label: '整理章节与段落…' });
  const chapters = pdfPagesToChapters(pageTexts);
  if (!chapters.length) throw new Error('未能从 PDF 提取到正文，请检查文件。');
  const title = file.name.replace(/\.pdf$/i, '').trim() || 'PDF 书籍';
  return {
    id: makeId('book'),
    title,
    author: 'PDF 导入',
    description: `从 PDF 提取的 ${chapters.length} 个章节，共 ${numPages} 页。`,
    cover: title.slice(0, 12).toUpperCase(),
    accent: ACCENTS[Math.floor(Math.random() * ACCENTS.length)],
    chapters,
    progress: 0,
    currentChapter: 0,
    currentParagraph: 0,
    addedAt: new Date().toISOString(),
    source: 'pdf',
  };
}
