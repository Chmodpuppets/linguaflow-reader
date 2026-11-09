import { useRef, useState } from 'react';
import { ArrowRight, BookOpen, Clock3, FileUp, Import, Library as LibraryIcon, Search, Sparkles, Trash2 } from 'lucide-react';
import type { Book } from '../types';
import { Button, EmptyState, Modal, ProgressBar } from './UI';
import { readingMinutes } from '../lib/utils';
import type { ImportProgress } from '../lib/epub';

export default function Library({ books, onOpen, onImport, onDelete, importing, importProgress }: { books: Book[]; onOpen: (book: Book) => void; onImport: (file: File) => Promise<void>; onDelete?: (id: string) => void; importing: boolean; importProgress?: ImportProgress | null }) {
  const [query, setQuery] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const recent = [...books].sort((a, b) => (b.lastReadAt || '').localeCompare(a.lastReadAt || ''))[0];
  const filtered = books.filter((book) => `${book.title} ${book.author}`.toLowerCase().includes(query.toLowerCase()));
  const totalProgress = books.length ? Math.round(books.reduce((sum, book) => sum + book.progress, 0) / books.length) : 0;
  const handleFile = async (file?: File) => {
    if (!file) return;
    try { await onImport(file); setImportOpen(false); }
    catch { /* 错误提示由统一通知中心展示，保留导入窗口以便重试。 */ }
  };
  return <div className="page library-page page-enter">
    <div className="page-heading"><div><span className="eyebrow">YOUR READING SPACE</span><h1>让每一次阅读，留下一点东西。</h1><p>Read with curiosity. Remember in context.</p></div><Button onClick={() => setImportOpen(true)}><Import size={17} />导入 EPUB</Button></div>
    {recent && <section className="continue-card glass-panel">
      <div className="continue-copy"><div className="section-kicker"><Sparkles size={15} />CONTINUE READING</div><h2>{recent.title}</h2><p>{recent.description}</p><div className="continue-meta"><span>{recent.author}</span><span><Clock3 size={14} />约 {readingMinutes(recent.chapters.reduce((n, c) => n + c.paragraphs.length, 0))} 分钟</span><span>{recent.chapters.length} 个章节</span></div><div className="continue-progress"><div><span>阅读进度</span><strong>{recent.progress}%</strong></div><ProgressBar value={recent.progress} /></div><Button size="lg" onClick={() => onOpen(recent)}>继续阅读<ArrowRight size={18} /></Button></div>
      <button className="hero-book" style={{ '--accent': recent.accent } as React.CSSProperties} onClick={() => onOpen(recent)} aria-label={`阅读 ${recent.title}`}><span>LINGUAFLOW EDITIONS</span><strong>{recent.cover}</strong><small>{recent.author}</small><i /></button>
    </section>}
    <section className="library-section"><div className="section-heading"><div><h2>我的书库 <span>{books.length}</span></h2><p>你的书、你的笔记、你的学习语境。</p></div><label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索书名或作者" /></label></div>
      {filtered.length ? <div className="book-grid">{filtered.map((book) => <article className="book-card glass-panel" key={book.id}>
        <button className="book-cover" style={{ '--accent': book.accent } as React.CSSProperties} onClick={() => onOpen(book)}><span>LINGUAFLOW EDITIONS</span><strong>{book.cover}</strong><small>{book.author}</small><i /></button>
        <div className="book-info"><div className="book-source">{book.source === 'epub' ? 'EPUB' : 'ORIGINAL SAMPLE'}</div><h3>{book.title}</h3><p>{book.author}</p><div className="book-progress"><div><span>{book.progress ? `已读 ${book.progress}%` : '尚未开始'}</span><span>{book.chapters.length} 章</span></div><ProgressBar value={book.progress} /></div><div className="book-actions"><Button variant="secondary" size="sm" onClick={() => onOpen(book)}>{book.progress ? '继续阅读' : '开始阅读'}<ArrowRight size={15} /></Button>{book.source === 'epub' && onDelete && <button className="book-delete" onClick={() => onDelete(book.id)} aria-label={`删除《${book.title}》`} title="删除这本书（含相关笔记与练习记录）"><Trash2 size={14} /></button>}</div></div>
      </article>)}</div> : <EmptyState icon={<LibraryIcon size={28} />} title="没有找到这本书" description="试试其他关键词，或导入一本新的 EPUB。" action={<Button onClick={() => setImportOpen(true)}>导入书籍</Button>} />}
    </section>
    <div className="library-footnote"><BookOpen size={15} /><span>所有示例文章均为原创演示内容。你导入的书籍只保存在本机，不会上传。</span><span>平均进度 {totalProgress}%</span></div>
    {importOpen && <Modal title="导入一本新书" eyebrow="MAKE IT YOURS" onClose={() => !importing && setImportOpen(false)}><div className={`drop-zone ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void handleFile(event.dataTransfer.files[0]); }}><div className="drop-icon"><FileUp size={28} /></div><h3>{importing ? (importProgress?.label || '正在提取章节与正文…') : '把 EPUB 文件拖到这里'}</h3><p>支持标准无 DRM 的 EPUB（≤ 60MB）；扫描图片版暂不支持。</p>{importing && importProgress?.phase === 'reading' && <div className="import-progress"><ProgressBar value={importProgress.progress} /><span>{importProgress.progress}%</span></div>}<input ref={fileRef} type="file" accept=".epub,application/epub+zip" hidden onChange={(event) => void handleFile(event.target.files?.[0])} /><Button variant="secondary" disabled={importing} onClick={() => fileRef.current?.click()}>{importing ? '正在导入…' : '选择 EPUB 文件'}</Button></div><div className="privacy-note"><strong>Local-first by design</strong><span>解析在浏览器内完成，书籍内容不会离开你的设备。</span></div></Modal>}
  </div>;
}
