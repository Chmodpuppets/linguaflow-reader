import JSZip from 'jszip';
import type { Book, Chapter } from '../types';

function parseXml(source: string, mime: DOMParserSupportedType = 'application/xml'): Document {
  const document = new DOMParser().parseFromString(source, mime);
  if (document.querySelector('parsererror')) throw new Error('文件结构无法解析，请尝试其他 EPUB。');
  return document;
}

function uniqueId(title: string): string {
  return `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'book'}-${Date.now()}`;
}

// 按书名确定性取色，让导入的不同书在书库封面里有视觉区分，而不是清一色品牌紫。
const ACCENTS = ['#8b5cf6', '#22d3ee', '#f59e0b', '#ec4899', '#10b981', '#ef4444', '#6366f1', '#14b8a6'];
function pickAccent(title: string): string {
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return ACCENTS[hash % ACCENTS.length];
}

export interface ImportProgress {
  phase: 'reading' | 'parsing';
  /** reading 阶段是真实百分比；parsing 阶段固定 100（JSZip 解析无进度事件）。 */
  progress: number;
  label: string;
}

/**
 * 用 FileReader 读文件并上报真实进度。
 * 特意不用 file.stream() 逐块拼 Uint8Array —— 那会让整份 EPUB 在内存里存在两份，
 * 对大文件（和内存吃紧的机器）很不友好；FileReader 直出一份 ArrayBuffer。
 */
function readFileWithProgress(file: File, onProgress?: (progress: ImportProgress) => void): Promise<ArrayBuffer> {
  if (typeof FileReader === 'undefined') return file.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (!event.lengthComputable || !event.total) return;
      const progress = Math.min(100, Math.round((event.loaded / event.total) * 100));
      onProgress?.({ phase: 'reading', progress, label: `读取文件 ${progress}%` });
    };
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
    reader.readAsArrayBuffer(file);
  });
}

export async function importEpub(file: File, onProgress?: (progress: ImportProgress) => void): Promise<Book> {
  const buffer = await readFileWithProgress(file, onProgress);
  onProgress?.({ phase: 'parsing', progress: 100, label: '正在提取章节与正文…' });
  const zip = await JSZip.loadAsync(buffer);
  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) throw new Error('这不是有效的 EPUB 文件。');
  const container = parseXml(await containerFile.async('text'));
  const opfPath = container.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) throw new Error('找不到 EPUB 的内容目录。');
  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error('EPUB 内容目录缺失。');
  const opf = parseXml(await opfFile.async('text'));
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const title = opf.querySelector('metadata > title, metadata > dc\\:title')?.textContent?.trim() || file.name.replace(/\.epub$/i, '');
  const author = opf.querySelector('metadata > creator, metadata > dc\\:creator')?.textContent?.trim() || 'Unknown author';
  const manifest = new Map<string, string>();
  opf.querySelectorAll('manifest item').forEach((item) => {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) manifest.set(id, href);
  });
  const chapters: Chapter[] = [];
  const spineItems = Array.from(opf.querySelectorAll('spine itemref'));
  for (let index = 0; index < spineItems.length; index += 1) {
    const idref = spineItems[index].getAttribute('idref') || '';
    const href = manifest.get(idref);
    if (!href) continue;
    const chapterFile = zip.file(`${base}${decodeURIComponent(href)}`);
    if (!chapterFile) continue;
    const html = parseXml(await chapterFile.async('text'), 'text/html');
    html.querySelectorAll('script, style, nav, svg').forEach((element) => element.remove());
    const blocks = Array.from(html.querySelectorAll('h1, h2, h3, p, blockquote'));
    const heading = blocks.find((block) => /^H[1-3]$/.test(block.tagName))?.textContent?.trim();
    const paragraphs = blocks
      .filter((block) => !/^H[1-3]$/.test(block.tagName))
      .map((block) => block.textContent?.replace(/\s+/g, ' ').trim() || '')
      // 只滤掉页码 / 纯符号噪声，保留短对话（"Yes," he said.）。
      // 旧写法 length > 24 会把小说里的短句整段丢掉，破坏原文完整性。
      .filter((text) => text.length >= 2 && /[a-zA-Z\u4e00-\u9fff]/.test(text) && !/^\d+$/.test(text));
    if (!paragraphs.length) {
      const bodyText = html.body?.textContent?.replace(/\s+/g, ' ').trim() || '';
      if (bodyText.length > 40) paragraphs.push(bodyText);
    }
    if (paragraphs.length) chapters.push({ id: `chapter-${index}`, title: heading || `Chapter ${chapters.length + 1}`, paragraphs });
  }
  if (!chapters.length) throw new Error('没有提取到可阅读的正文。该 EPUB 可能是扫描图片或受 DRM 保护。');
  return {
    id: uniqueId(title),
    title,
    author,
    description: `${chapters.length} chapters · Imported from EPUB`,
    cover: title.split(/\s+/).slice(0, 2).join(' ').toUpperCase(),
    accent: pickAccent(title),
    chapters,
    progress: 0,
    currentChapter: 0,
    currentParagraph: 0,
    addedAt: new Date().toISOString(),
    source: 'epub',
  };
}
