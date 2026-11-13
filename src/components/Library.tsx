import { useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpen, BookOpenCheck, Clock3, FileUp, Flame, Import, Library as LibraryIcon, Minus, Plus, Search, Sparkles, Target, Trash2, Type } from 'lucide-react';
import type { Book } from '../types';
import { Button, EmptyState, Modal, ProgressBar } from './UI';
import { readingMinutes } from '../lib/utils';
import { bookDifficulty } from '../lib/difficulty';
import type { ImportProgress } from '../lib/epub';

export interface LibraryStats { known: number; learning: number; streak: number; today: number; goal: number }

/** 难度徽章：覆盖率 + 分档。已知词为空（无法评估）时不渲染。 */
function DifficultyBadge({ book, known }: { book: Book; known: ReadonlySet<string> }) {
  const diff = bookDifficulty(book, known);
  if (!diff) return null;
  return <span className={`difficulty-badge band-${diff.band.key}`} title={`词频加权覆盖率 ${diff.coverage}%：书中约 ${diff.coverage}% 的词次你已认识`}>{diff.band.label} · {diff.coverage}%</span>;
}

export default function Library({ books, knownWords, onOpen, onImport, onImportText, onDelete, importing, importProgress, stats, onGoal }: { books: Book[]; knownWords?: string[]; onOpen: (book: Book) => void; onImport: (file: File) => Promise<void>; onImportText: (title: string, text: string) => Promise<void>; onDelete?: (id: string) => void; importing: boolean; importProgress?: ImportProgress | null; stats?: LibraryStats; onGoal?: (goal: number) => void }) {
  const knownSet = useMemo(() => new Set((knownWords || []).map((word) => word.toLowerCase())), [knownWords]);
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<'default' | 'match'>('default');
  const [onlyIdeal, setOnlyIdeal] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importTab, setImportTab] = useState<'epub' | 'text'>('epub');
  const [textTitle, setTextTitle] = useState('');
  const [textBody, setTextBody] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const recent = [...books].sort((a, b) => (b.lastReadAt || '').localeCompare(a.lastReadAt || ''))[0];
  const recentDiff = recent ? bookDifficulty(recent, knownSet) : null;
  const filtered = books.filter((book) => `${book.title} ${book.author}`.toLowerCase().includes(query.toLowerCase()));
  const diffs = useMemo(() => new Map(books.map((book) => [book.id, bookDifficulty(book, knownSet)])), [books, knownSet]);
  const canMatch = knownSet.size > 0;
  const displayed = useMemo(() => {
    let list = filtered;
    if (canMatch && onlyIdeal) list = list.filter((book) => diffs.get(book.id)?.band.ideal);
    if (canMatch && sortMode === 'match') {
      const rank = (book: Book) => { const d = diffs.get(book.id); return d ? { ideal: d.band.ideal ? 1 : 0, dist: Math.abs(d.coverage - 94), cov: d.coverage } : { ideal: 0, dist: 999, cov: -1 }; };
      list = [...list].sort((a, b) => { const ra = rank(a); const rb = rank(b); return rb.ideal - ra.ideal || ra.dist - rb.dist || rb.cov - ra.cov; });
    }
    return list;
  }, [filtered, canMatch, onlyIdeal, sortMode, diffs]);
  const totalProgress = books.length ? Math.round(books.reduce((sum, book) => sum + book.progress, 0) / books.length) : 0;
  const handleFile = async (file?: File) => {
    if (!file) return;
    try { await onImport(file); setImportOpen(false); }
    catch { /* 错误提示由统一通知中心展示，保留导入窗口以便重试。 */ }
  };
  const handleText = async () => {
    if (!textBody.trim()) return;
    try { await onImportText(textTitle, textBody); setImportOpen(false); setTextBody(''); setTextTitle(''); }
    catch { /* 通知中心已提示，保留窗口。 */ }
  };
  const goal = stats?.goal ?? 5;
  const todayPct = stats ? Math.min(100, Math.round((stats.today / Math.max(1, goal)) * 100)) : 0;
  return <div className="page library-page page-enter">
    <div className="page-heading"><div><span className="eyebrow">YOUR READING SPACE</span><h1>让每一次阅读，留下一点东西。</h1><p>Read with curiosity. Remember in context.</p></div><div className="heading-actions"><Button variant="secondary" onClick={() => { setImportTab('text'); setImportOpen(true); }}><Type size={17} />粘贴文本</Button><Button onClick={() => { setImportTab('epub'); setImportOpen(true); }}><Import size={17} />导入 EPUB</Button></div></div>
    {stats && <section className="goal-strip glass-panel" aria-label="学习进度与每日目标">
      <div className="goal-stat"><BookOpenCheck size={18} /><div><b>{stats.known}</b><span>已掌握词</span></div></div>
      <div className="goal-stat"><Sparkles size={18} /><div><b>{stats.learning}</b><span>学习中</span></div></div>
      <div className="goal-stat"><Flame size={18} /><div><b>{stats.streak}</b><span>连续天数</span></div></div>
      <div className="goal-stat goal-today"><Target size={18} /><div><b>{stats.today}/{goal}</b><span>今日目标</span><ProgressBar value={todayPct} /></div>
        {onGoal && <div className="goal-stepper"><button aria-label="降低每日目标" onClick={() => onGoal(Math.max(1, goal - 1))}><Minus size={13} /></button><button aria-label="提高每日目标" onClick={() => onGoal(Math.min(50, goal + 1))}><Plus size={13} /></button></div>}
      </div>
    </section>}
    {recent && <section className="continue-card glass-panel">
      <div className="continue-copy"><div className="section-kicker"><Sparkles size={15} />CONTINUE READING</div><h2>{recent.title}</h2><p>{recent.description}</p><div className="continue-meta"><span>{recent.author}</span><span><Clock3 size={14} />约 {readingMinutes(recent.chapters.reduce((n, c) => n + c.paragraphs.length, 0))} 分钟</span><span>{recent.chapters.length} 个章节</span>{recentDiff && <DifficultyBadge book={recent} known={knownSet} />}</div></div>
      <div className="continue-action"><div className="progress-ring" style={{ '--progress': `${recent.progress * 3.6}deg` } as React.CSSProperties}><span>{recent.progress}%</span></div><Button onClick={() => onOpen(recent)}>继续阅读<ArrowRight size={17} /></Button></div>
    </section>}
    <div className="library-toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索书名或作者" aria-label="搜索书库" /></div><div className="library-stats"><LibraryIcon size={16} /><span>{books.length} 本书</span><span>平均进度 {totalProgress}%</span></div></div>
    {canMatch && <div className="library-tools" role="group" aria-label="选书排序与筛选"><div className="seg-control"><button className={sortMode === 'default' ? 'active' : ''} onClick={() => setSortMode('default')}>综合</button><button className={sortMode === 'match' ? 'active' : ''} onClick={() => setSortMode('match')}><Sparkles size={14} />难度匹配</button></div><button className={`filter-chip ${onlyIdeal ? 'active' : ''}`} aria-pressed={onlyIdeal} onClick={() => setOnlyIdeal((v) => !v)}>只看 i+1 · 匹配你的水平</button><span className="tools-hint">覆盖率 90–98% 为 i+1：多数词认识、少量新词，读得动又有收获。</span></div>}
    {displayed.length ? <div className="book-grid">{displayed.map((book) => <article className="book-card glass-panel" key={book.id}>
      <button className="book-cover-button" onClick={() => onOpen(book)} aria-label={`打开《${book.title}》`}><div className={`book-cover${book.coverImage ? ' has-image' : ''}`} style={{ '--accent': book.accent } as React.CSSProperties}>{book.coverImage ? <img className="book-cover-img" src={book.coverImage} alt="" /> : <><span className="cover-kicker">LINGUAFLOW</span><strong>{book.title}</strong><i>{book.author}</i></>}</div></button>
      <div className="book-info"><div className="book-title-row"><h3>{book.title}</h3>{onDelete && book.source !== 'sample' && <button className="icon-button subtle" onClick={() => onDelete(book.id)} aria-label={`删除《${book.title}》`}><Trash2 size={15} /></button>}</div><p>{book.author}</p><div className="book-tags"><DifficultyBadge book={book} known={knownSet} /><span>{book.chapters.length} 章</span><span>{book.source === 'epub' ? 'EPUB' : book.source === 'text' ? '文本' : '样书'}</span></div><div className="book-progress"><ProgressBar value={book.progress} /><span>{book.progress}%</span></div><Button variant="secondary" size="sm" onClick={() => onOpen(book)}><BookOpen size={15} />{book.progress ? '继续阅读' : '开始阅读'}</Button></div>
    </article>)}</div> : <EmptyState icon={<LibraryIcon size={28} />} title="没有找到这本书" description="换一个关键词，或导入你自己的 EPUB / 文本。" action={<Button onClick={() => { setImportTab('epub'); setImportOpen(true); }}>导入内容</Button>} />}
    {importOpen && <Modal title={importTab === 'epub' ? '导入 EPUB' : '粘贴文本'} onClose={() => setImportOpen(false)}>
      <div className="import-tabs segmented" role="group" aria-label="导入方式"><button className={importTab === 'epub' ? 'active' : ''} onClick={() => setImportTab('epub')}>EPUB 文件</button><button className={importTab === 'text' ? 'active' : ''} onClick={() => setImportTab('text')}>粘贴文本</button></div>
      {importTab === 'epub' ? <div className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void handleFile(event.dataTransfer.files[0]); }}><div className="drop-icon"><FileUp size={28} /></div><h3>{importing ? (importProgress?.label || '正在提取章节与正文…') : '把 EPUB / TXT / MD 文件拖到这里'}</h3><p>支持标准无 DRM 的 EPUB（≤ 60MB）与纯文本 / Markdown；扫描图片版暂不支持。</p>{importing && importProgress?.phase === 'reading' && <div className="import-progress"><ProgressBar value={importProgress.progress} /><span>{importProgress.progress}%</span></div>}<input ref={fileRef} type="file" accept=".epub,.txt,.md,.markdown,application/epub+zip,text/plain,text/markdown" hidden onChange={(event) => void handleFile(event.target.files?.[0])} /><Button variant="secondary" disabled={importing} onClick={() => fileRef.current?.click()}>{importing ? '正在导入…' : '选择文件'}</Button></div>
      : <div className="text-import"><label className="field"><span>标题（可选）</span><input value={textTitle} onChange={(event) => setTextTitle(event.target.value)} placeholder="文章 / 书名" /></label><label className="field"><span>正文</span><textarea value={textBody} onChange={(event) => setTextBody(event.target.value)} rows={10} placeholder="粘贴英文文章、新闻、演讲稿或 Markdown…空行分段，# 标题分章。" /></label><Button disabled={importing || !textBody.trim()} onClick={() => void handleText()}>{importing ? '正在导入…' : '导入为可阅读的书'}</Button></div>}
      <div className="privacy-note"><strong>Local-first by design</strong><span>解析在浏览器内完成，书籍内容不会离开你的设备。</span></div>
    </Modal>}
  </div>;
}
