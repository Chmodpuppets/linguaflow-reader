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

/** 把相对 href 解析成 zip 内绝对路径（处理 ../ 与 .），并分离 #fragment。 */
function resolveHref(dir: string, href: string): { path: string; fragment: string } {
  const [rawPath, fragment = ''] = href.split('#');
  const decoded = decodeURIComponent(rawPath);
  const parts = `${dir}${decoded}`.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return { path: stack.join('/'), fragment };
}

function dirOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
}

// 块级标签集合：用于识别「容器」与「叶子段落」。很多 EPUB（尤其 AmazonClassics 等
// 转制书）把每个自然段放在 <div class="para"> 而非 <p>；只查 p 会漏掉全部段落，
// 退化成整章拼接成一坨（段落边界连空格都丢，如 "stove.It"）。这里把 div/li/section 等
// 一并纳入，并只取「叶子块」（内部不再嵌套块级标签），容器交给它的子块去贡献段落。
const BLOCK_SELECTOR = 'p, div, blockquote, li, section, article, h1, h2, h3, h4, h5, h6';

/** 把一段 innerHTML 按 <br> 切成若干纯文本段落（处理用 <br> 分段的书）。 */
function segmentsOf(html: Document, block: Element): string[] {
  const inner = block.innerHTML || '';
  const parts = /<br\s*\/?>/i.test(inner) ? inner.split(/<br\s*\/?>/i) : [inner];
  const out: string[] = [];
  for (const part of parts) {
    const span = html.createElement('span');
    span.innerHTML = part;
    const text = span.textContent?.replace(/\s+/g, ' ').trim() || '';
    if (text) out.push(text);
  }
  return out;
}

/** 从一个章节 XHTML 里提取标题与正文段落（去掉导航 / 脚本 / 样式 / 矢量噪声）。 */
function extractChapter(html: Document, root?: Element): { heading?: string; paragraphs: string[] } {
  html.querySelectorAll('script, style, nav, svg').forEach((element) => element.remove());
  const scope: ParentNode = root || html;
  const blocks = Array.from(scope.querySelectorAll(BLOCK_SELECTOR));
  const heading = blocks.find((block) => /^H[1-3]$/.test(block.tagName))?.textContent?.trim();
  const paragraphs: string[] = [];
  for (const block of blocks) {
    if (/^H[1-6]$/.test(block.tagName)) continue; // 标题不算正文段落
    if (block.querySelector(BLOCK_SELECTOR)) continue; // 容器块：交给子块，避免整章重复拼接
    for (const text of segmentsOf(html, block)) {
      // 只滤掉页码 / 纯符号噪声 / 裸章节标记（"CHAPTER 1" 已由标题展示），保留短对话。
      if (text.length >= 2 && /[a-zA-Z一-鿿]/.test(text) && !/^\d+$/.test(text) && !/^(chapter|part)\s+[0-9ivxlc]+$/i.test(text)) paragraphs.push(text);
    }
  }
  if (!paragraphs.length) {
    const bodyText = (root || html.body)?.textContent?.replace(/\s+/g, ' ').trim() || '';
    if (bodyText.length > 40) paragraphs.push(bodyText);
  }
  return { heading, paragraphs };
}

/**
 * 找出封面图片在 zip 内的路径。优先级：
 * 1. EPUB3 manifest properties~cover-image；
 * 2. EPUB2 metadata meta[name=cover]@content（manifest id 或直接 href）；
 * 3. guide reference[type=cover]（一个 XHTML，取其首张 <img>）；
 * 4. id / href 含 "cover" 的图片资源。
 */
function findCoverPath(opf: Document, manifest: Map<string, string>, base: string): string | undefined {
  const items = Array.from(opf.querySelectorAll('manifest item'));
  const isImage = (el: Element) => (el.getAttribute('media-type') || '').startsWith('image/');
  const ep3 = items.find((el) => isImage(el) && (el.getAttribute('properties') || '').split(/\s+/).includes('cover-image'));
  if (ep3) return resolveHref(base, ep3.getAttribute('href') || '').path;
  const content = opf.querySelector('metadata > meta[name="cover"]')?.getAttribute('content');
  if (content) {
    const byId = manifest.get(content);
    if (byId) return resolveHref(base, byId).path;
    if (items.some((el) => isImage(el) && el.getAttribute('href') === content)) return resolveHref(base, content).path;
  }
  const guide = opf.querySelector('guide > reference[type="cover"]');
  if (guide) return resolveHref(base, guide.getAttribute('href') || '').path;
  const named = items.find((el) => isImage(el) && (/cover/i.test(el.getAttribute('id') || '') || /cover/i.test(el.getAttribute('href') || '')));
  if (named) return resolveHref(base, named.getAttribute('href') || '').path;
  return undefined;
}

/** 把封面位图压缩成有界 data URL（最长边 640、JPEG），避免撑爆 localStorage / 备份。 */
async function coverDataUrl(blob: Blob): Promise<string | undefined> {
  if (typeof createImageBitmap === 'undefined' || typeof document === 'undefined') return undefined;
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    let url = canvas.toDataURL('image/jpeg', 0.85);
    if (url.length > 400_000) url = canvas.toDataURL('image/jpeg', 0.7);
    return url;
  } catch {
    return undefined;
  }
}

interface TocEntry { title: string; href: string }

/** 读取 EPUB3 nav 或 EPUB2 NCX 目录，返回有序 {title, href}；没有则 null。 */
async function readToc(zip: JSZip, opf: Document, manifest: Map<string, string>, base: string): Promise<{ entries: TocEntry[]; dir: string } | null> {
  // EPUB3：manifest 里 properties 含 nav 的文档。
  let navHref: string | undefined;
  opf.querySelectorAll('manifest item').forEach((item) => {
    if ((item.getAttribute('properties') || '').split(/\s+/).includes('nav')) navHref = item.getAttribute('href') || undefined;
  });
  if (navHref) {
    const navPath = resolveHref(base, navHref).path;
    const navFile = zip.file(navPath);
    if (navFile) {
      const nav = parseXml(await navFile.async('text'), 'text/html');
      const navEls = Array.from(nav.querySelectorAll('nav'));
      const tocNav = navEls.find((el) => (el.getAttribute('epub:type') || '').split(/\s+/).includes('toc')) || navEls[0];
      if (tocNav) {
        const entries = Array.from(tocNav.querySelectorAll('a[href]'))
          .map((a) => ({ title: a.textContent?.replace(/\s+/g, ' ').trim() || '', href: a.getAttribute('href') || '' }))
          .filter((entry) => entry.href);
        if (entries.length) return { entries, dir: dirOf(navPath) };
      }
    }
  }
  // EPUB2：spine toc 属性指向 NCX。
  const tocId = opf.querySelector('spine')?.getAttribute('toc');
  const ncxHref = tocId ? manifest.get(tocId) : undefined;
  if (ncxHref) {
    const ncxPath = resolveHref(base, ncxHref).path;
    const ncxFile = zip.file(ncxPath);
    if (ncxFile) {
      const ncx = parseXml(await ncxFile.async('text'));
      const entries = Array.from(ncx.querySelectorAll('navMap navPoint'))
        .map((point) => ({
          title: point.querySelector('navLabel text')?.textContent?.replace(/\s+/g, ' ').trim() || '',
          href: point.querySelector('content')?.getAttribute('src') || '',
        }))
        .filter((entry) => entry.href);
      if (entries.length) return { entries, dir: dirOf(ncxPath) };
    }
  }
  return null;
}

// 前置 / 后置页不占章节。AmazonClassics 等书的 NCX 用 "COPYRIGHT PAGE" / "START READING" /
// "ABOUT THE AUTHOR" 这类标签，旧正则只匹配裸 "copyright" 会把版权页当成 Chapter 1。
const FRONT_MATTER = /^(cover|contents|table of contents|title page|copyright( page)?|also by.*|dedication|start reading|about the (author|publisher)|acknowledgments?|目录|封面|版权(页)?|扉页|献词)$/i;

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
  const base = dirOf(opfPath);
  const title = opf.querySelector('metadata > title, metadata > dc\\:title')?.textContent?.trim() || file.name.replace(/\.epub$/i, '');
  const author = opf.querySelector('metadata > creator, metadata > dc\\:creator')?.textContent?.trim() || 'Unknown author';
  const manifest = new Map<string, string>();
  opf.querySelectorAll('manifest item').forEach((item) => {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) manifest.set(id, href);
  });

  const htmlCache = new Map<string, Document>();
  const loadHtml = async (path: string): Promise<Document | null> => {
    if (htmlCache.has(path)) return htmlCache.get(path) || null;
    const chapterFile = zip.file(path);
    if (!chapterFile) return null;
    const html = parseXml(await chapterFile.async('text'), 'text/html');
    htmlCache.set(path, html);
    return html;
  };

  // 提取真实封面（压缩为有界 data URL），让书库一眼可辨；失败则回退生成封面。
  let coverImage: string | undefined;
  const coverPath = findCoverPath(opf, manifest, base);
  if (coverPath) {
    const coverFile = zip.file(coverPath);
    if (coverFile) {
      if (/\.(xhtml|html|htm)$/i.test(coverPath)) {
        const coverDoc = await loadHtml(coverPath);
        const imgSrc = coverDoc?.querySelector('img')?.getAttribute('src');
        if (imgSrc) {
          const imgFile = zip.file(resolveHref(dirOf(coverPath), imgSrc).path);
          if (imgFile) coverImage = await coverDataUrl(await imgFile.async('blob'));
        }
      } else {
        coverImage = await coverDataUrl(await coverFile.async('blob'));
      }
    }
  }

  const chapters: Chapter[] = [];
  // 优先按书自带的目录（nav / NCX）建章节：标题与顺序以目录为准，
  // 避免把 spine 里的扉页 / 目录页 / 版权页当成「Chapter N」导致章节错位。
  const toc = await readToc(zip, opf, manifest, base);
  if (toc) {
    const seen = new Set<string>();
    for (const entry of toc.entries) {
      if (FRONT_MATTER.test(entry.title)) continue;
      const { path, fragment } = resolveHref(toc.dir, entry.href);
      const key = `${path}#${fragment}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const html = await loadHtml(path);
      if (!html) continue;
      const anchor = fragment ? html.getElementById(fragment) : null;
      const root = anchor && /^(SECTION|DIV|ARTICLE|BODY|MAIN)$/.test(anchor.tagName) ? anchor : undefined;
      const { heading, paragraphs } = extractChapter(html, root);
      if (!paragraphs.length) continue;
      chapters.push({ id: `chapter-${chapters.length}`, title: entry.title || heading || `Chapter ${chapters.length + 1}`, paragraphs });
    }
  }

  // 无目录（或目录解析不出正文）时回退到 spine 顺序。
  if (!chapters.length) {
    const spineItems = Array.from(opf.querySelectorAll('spine itemref'));
    for (let index = 0; index < spineItems.length; index += 1) {
      const idref = spineItems[index].getAttribute('idref') || '';
      const href = manifest.get(idref);
      if (!href) continue;
      const { path } = resolveHref(base, href);
      const html = await loadHtml(path);
      if (!html) continue;
      const { heading, paragraphs } = extractChapter(html);
      if (paragraphs.length) chapters.push({ id: `chapter-${index}`, title: heading || `Chapter ${chapters.length + 1}`, paragraphs });
    }
  }

  if (!chapters.length) throw new Error('没有提取到可阅读的正文。该 EPUB 可能是扫描图片或受 DRM 保护。');
  return {
    id: uniqueId(title),
    title,
    author,
    description: `${chapters.length} chapters · Imported from EPUB`,
    cover: title.split(/\s+/).slice(0, 2).join(' ').toUpperCase(),
    accent: pickAccent(title),
    coverImage,
    chapters,
    progress: 0,
    currentChapter: 0,
    currentParagraph: 0,
    addedAt: new Date().toISOString(),
    source: 'epub',
  };
}
