import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, AudioLines, Bookmark, BookOpen, BookOpenCheck, ChevronDown, ChevronUp, Clock3, Compass, FileUp, Flame, FolderOpen, Import, Library as LibraryIcon, ListMusic, ListPlus, Minus, Play, Plus, Search, Sparkles, Tags, Target, Trash2, Type } from 'lucide-react';
import type { Book, LibraryView, Playlist } from '../types';
import { Button, EmptyState, Modal, ProgressBar } from './UI';
const LessonBuilder = lazy(() => import('./LessonBuilder'));
const PlaylistPlayer = lazy(() => import('./PlaylistPlayer'));
import { readingMinutes } from '../lib/utils';
import { bookDifficulty, coldStartPick, recommendBook } from '../lib/difficulty';
import { allTags, filterByTag, parseTags, viewMatches } from '../lib/libraryOrganize';
import { moveBook, resolvePlaylistBooks } from '../lib/playlist';
import type { ImportProgress } from '../lib/epub';

export interface LibraryStats { known: number; learning: number; streak: number; today: number; goal: number }

const BOOK_EXT = /\.(epub|pdf|txt|md|markdown)$/i;
function isBookFileName(name: string): boolean { return BOOK_EXT.test(name); }

/** 递归收集拖拽目录里的书籍文件（webkitGetAsEntry 路径）。 */
async function collectEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    if (isBookFileName(file.name)) out.push(file);
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    for (const child of children) await collectEntry(child, out);
  }
}

/** 递归收集「选择文件夹」（File System Access API）里的书籍文件。 */
async function collectHandle(handle: { kind: string; name: string; getFile?: () => Promise<File>; values?: () => AsyncIterable<unknown> }, out: File[]): Promise<void> {
  if (handle.kind === 'file' && handle.getFile) {
    const file = await handle.getFile();
    if (isBookFileName(file.name)) out.push(file);
  } else if (handle.kind === 'directory' && handle.values) {
    for await (const child of handle.values()) await collectHandle(child as typeof handle, out);
  }
}

/** 难度徽章：覆盖率 + 分档。已知词为空（无法评估）时不渲染。 */
function DifficultyBadge({ book, known }: { book: Book; known: ReadonlySet<string> }) {
  const diff = bookDifficulty(book, known);
  if (!diff) return null;
  return <span className={`difficulty-badge band-${diff.band.key}`} title={`词频加权覆盖率 ${diff.coverage}%：书中约 ${diff.coverage}% 的词次你已认识`}>{diff.band.label} · {diff.coverage}%</span>;
}

export default function Library({ books, knownWords, onOpen, onImport, onImportText, onLessonCreated, onDelete, importing, importProgress, stats, onGoal, views, onSaveView, onDeleteView, onSetTags, playlists, onCreatePlaylist, onDeletePlaylist, onRenamePlaylist, onAddToPlaylist, onRemoveFromPlaylist, onReorderPlaylist }: { books: Book[]; knownWords?: string[]; onOpen: (book: Book) => void; onImport: (file: File) => Promise<void>; onImportText: (title: string, text: string) => Promise<void>; onLessonCreated?: (book: Book) => void; onDelete?: (id: string) => void; importing: boolean; importProgress?: ImportProgress | null; stats?: LibraryStats; onGoal?: (goal: number) => void; views?: LibraryView[]; onSaveView?: (view: Omit<LibraryView, 'id'>) => void; onDeleteView?: (id: string) => void; onSetTags?: (id: string, tags: string[]) => void; playlists?: Playlist[]; onCreatePlaylist?: (name: string) => string; onDeletePlaylist?: (id: string) => void; onRenamePlaylist?: (id: string, name: string) => void; onAddToPlaylist?: (playlistId: string, bookId: string) => void; onRemoveFromPlaylist?: (playlistId: string, bookId: string) => void; onReorderPlaylist?: (playlistId: string, bookIds: string[]) => void }) {
  const knownSet = useMemo(() => new Set((knownWords || []).map((word) => word.toLowerCase())), [knownWords]);
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<'default' | 'match'>('default');
  const [onlyIdeal, setOnlyIdeal] = useState(false);
  const [activeTag, setActiveTag] = useState('');
  const [viewsOpen, setViewsOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const [tagEditBook, setTagEditBook] = useState<Book | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importTab, setImportTab] = useState<'epub' | 'text' | 'audio'>('epub');
  const [textTitle, setTextTitle] = useState('');
  const [textBody, setTextBody] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const recent = [...books].sort((a, b) => (b.lastReadAt || '').localeCompare(a.lastReadAt || ''))[0];
  const recentDiff = recent ? bookDifficulty(recent, knownSet) : null;
  const tags = useMemo(() => allTags(books), [books]);
  const filtered = filterByTag(books, activeTag).filter((book) => `${book.title} ${book.author}`.toLowerCase().includes(query.toLowerCase()));
  const applyView = (view: LibraryView) => { setQuery(view.query); setSortMode(view.sortMode); setOnlyIdeal(view.onlyIdeal); setActiveTag(view.tag); setViewsOpen(false); };
  const currentView = { query, sortMode, onlyIdeal, tag: activeTag };
  const openTagEditor = (book: Book) => { setTagEditBook(book); setTagDraft((book.tags || []).join('，')); };
  // 播放列表：管理弹窗（列表 / 选中某列表管理曲目）+ 书卡「加入播放列表」选择器 + 连续播放器。
  const [playlistsOpen, setPlaylistsOpen] = useState(false);
  const [playlistName, setPlaylistName] = useState('');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [addBookTarget, setAddBookTarget] = useState<Book | null>(null);
  const [newPlaylistForBook, setNewPlaylistForBook] = useState('');
  const [playerPlaylist, setPlayerPlaylist] = useState<Playlist | null>(null);
  const selectedPlaylist = (playlists || []).find((p) => p.id === selectedPlaylistId) || null;
  const playerBooks = useMemo(() => (playerPlaylist ? resolvePlaylistBooks(playerPlaylist, books) : []), [playerPlaylist, books]);
  const openPlaylists = () => { setSelectedPlaylistId(null); setPlaylistsOpen(true); };
  const moveTrack = (playlist: Playlist, from: number, to: number) => { if (onReorderPlaylist) onReorderPlaylist(playlist.id, moveBook(playlist.bookIds, from, to)); };
  const diffs = useMemo(() => new Map(books.map((book) => [book.id, bookDifficulty(book, knownSet)])), [books, knownSet]);
  const canMatch = knownSet.size > 0;
  const recommendation = useMemo(() => recommendBook(books, knownSet), [books, knownSet]);
  const coldStart = useMemo(() => (knownSet.size ? null : coldStartPick(books)), [books, knownSet]);
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
  const handleFiles = async (files: File[]) => {
    const books = files.filter((f) => isBookFileName(f.name));
    if (!books.length) return;
    for (const file of books) {
      try { await onImport(file); } catch { /* 单本失败不阻断其余，通知中心已提示。 */ }
    }
    setImportOpen(false);
  };
  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault(); setDragging(false);
    const entries = Array.from(event.dataTransfer.items || []).map((item) => item.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
    if (entries.some((e) => e.isDirectory)) {
      const files: File[] = [];
      for (const entry of entries) await collectEntry(entry, files);
      await handleFiles(files);
    } else {
      await handleFiles(Array.from(event.dataTransfer.files));
    }
  };
  const pickFolder = async () => {
    const picker = (window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    if (!picker) { fileRef.current?.click(); return; }
    try {
      const dir = await picker();
      const files: File[] = [];
      // @ts-expect-error 异步迭代器在部分 TS dom lib 未声明
      for await (const entry of dir.values()) await collectHandle(entry, files);
      await handleFiles(files);
    } catch { /* 用户取消选择 */ }
  };
  const handleText = async () => {
    if (!textBody.trim()) return;
    try { await onImportText(textTitle, textBody); setImportOpen(false); setTextBody(''); setTextTitle(''); }
    catch { /* 通知中心已提示，保留窗口。 */ }
  };
  const goal = stats?.goal ?? 5;
  const todayPct = stats ? Math.min(100, Math.round((stats.today / Math.max(1, goal)) * 100)) : 0;
  return <div className="page library-page page-enter">
    <div className="page-heading"><div><span className="eyebrow">YOUR READING SPACE</span><h1>让每一次阅读，留下一点东西。</h1><p>Read with curiosity. Remember in context.</p></div><div className="heading-actions"><Button variant="secondary" onClick={() => { setImportTab('text'); setImportOpen(true); }}><Type size={17} />粘贴文本</Button><Button variant="secondary" onClick={() => { setImportTab('audio'); setImportOpen(true); }}><AudioLines size={17} />音频/字幕建课</Button><Button onClick={() => { setImportTab('epub'); setImportOpen(true); }}><Import size={17} />导入书籍</Button></div></div>
    {stats && <section className="goal-strip glass-panel" aria-label="学习进度与每日目标">
      <div className="goal-stat"><BookOpenCheck size={18} /><div><b>{stats.known}</b><span>已掌握词</span></div></div>
      <div className="goal-stat"><Sparkles size={18} /><div><b>{stats.learning}</b><span>学习中</span></div></div>
      <div className="goal-stat"><Flame size={18} /><div><b>{stats.streak}</b><span>连续天数</span></div></div>
      <div className="goal-stat goal-today"><Target size={18} /><div><b>{stats.today}/{goal}</b><span>今日目标</span><ProgressBar value={todayPct} /></div>
        {onGoal && <div className="goal-stepper"><button aria-label="降低每日目标" onClick={() => onGoal(Math.max(1, goal - 1))}><Minus size={13} /></button><button aria-label="提高每日目标" onClick={() => onGoal(Math.min(50, goal + 1))}><Plus size={13} /></button></div>}
      </div>
    </section>}
    {recommendation && <section className="recommend-card glass-panel" aria-label="今日推荐">
      <div className="recommend-icon"><Compass size={20} /></div>
      <div className="recommend-copy"><span className="section-kicker">TODAY'S PICK · 今日推荐</span><h2>{recommendation.book.title}</h2><p>{recommendation.reason}</p></div>
      <div className="recommend-action"><span className={`difficulty-badge band-${recommendation.band.key}`}>{recommendation.band.label} · {recommendation.coverage}%</span><Button onClick={() => onOpen(recommendation.book)}>{recommendation.book.progress ? '继续阅读' : '开始阅读'}<ArrowRight size={16} /></Button></div>
    </section>}
    {!recommendation && coldStart && <section className="recommend-card cold-start glass-panel" aria-label="入门推荐">
      <div className="recommend-icon"><Compass size={20} /></div>
      <div className="recommend-copy"><span className="section-kicker">START HERE · 入门推荐</span><h2>{coldStart.book.title}</h2><p>{coldStart.reason}</p></div>
      <div className="recommend-action">{coldStart.book.level && <span className="level-badge">{coldStart.book.level}</span>}<Button onClick={() => onOpen(coldStart.book)}>{coldStart.book.progress ? '继续阅读' : '开始阅读'}<ArrowRight size={16} /></Button></div>
    </section>}
    {recent && <section className="continue-card glass-panel">
      <div className="continue-copy"><div className="section-kicker"><Sparkles size={15} />CONTINUE READING</div><h2>{recent.title}</h2><p>{recent.description}</p><div className="continue-meta"><span>{recent.author}</span><span><Clock3 size={14} />约 {readingMinutes(recent.chapters.reduce((n, c) => n + c.paragraphs.length, 0))} 分钟</span><span>{recent.chapters.length} 个章节</span>{recentDiff && <DifficultyBadge book={recent} known={knownSet} />}</div></div>
      <div className="continue-side">
        <button className={`hero-book${recent.coverImage ? ' has-image' : ''}`} style={{ '--accent': recent.accent } as React.CSSProperties} onClick={() => onOpen(recent)} aria-label={`继续阅读《${recent.title}》`}>{recent.coverImage ? <img className="book-cover-img" src={recent.coverImage} alt="" /> : <><span>LINGUAFLOW</span><strong>{recent.title}</strong><small>{recent.author}</small><i /></>}</button>
        <div className="continue-action"><div className="progress-ring" style={{ '--progress': `${recent.progress * 3.6}deg` } as React.CSSProperties}><span>{recent.progress}%</span></div><Button onClick={() => onOpen(recent)}>继续阅读<ArrowRight size={17} /></Button></div>
      </div>
    </section>}
    <div className="library-toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索书名或作者" aria-label="搜索书库" /></div><div className="library-stats"><LibraryIcon size={16} /><span>{books.length} 本书</span><span>平均进度 {totalProgress}%</span></div></div>
    {(tags.length > 0 || (views && views.length > 0) || onSaveView || onCreatePlaylist) && <div className="library-organize">
      <div className="tag-chips" role="group" aria-label="按标签筛选"><button className={`filter-chip ${activeTag === '' ? 'active' : ''}`} onClick={() => setActiveTag('')}>全部</button>{tags.map((tag) => <button key={tag} className={`filter-chip ${activeTag === tag ? 'active' : ''}`} aria-pressed={activeTag === tag} onClick={() => setActiveTag(activeTag === tag ? '' : tag)}><Tags size={13} />{tag}</button>)}</div>
      <div className="organize-actions">
        {onCreatePlaylist && <button className="views-button playlists-button" onClick={openPlaylists}><ListMusic size={15} />播放列表{playlists && playlists.length ? ` · ${playlists.length}` : ''}</button>}
        {onSaveView && <button className="views-button" onClick={() => setViewsOpen(true)}><Bookmark size={15} />视图{views && views.length ? ` · ${views.length}` : ''}</button>}
      </div>
    </div>}
    {canMatch && <div className="library-tools" role="group" aria-label="选书排序与筛选"><div className="seg-control"><button className={sortMode === 'default' ? 'active' : ''} onClick={() => setSortMode('default')}>综合</button><button className={sortMode === 'match' ? 'active' : ''} onClick={() => setSortMode('match')}><Sparkles size={14} />难度匹配</button></div><button className={`filter-chip ${onlyIdeal ? 'active' : ''}`} aria-pressed={onlyIdeal} onClick={() => setOnlyIdeal((v) => !v)}>只看 i+1 · 匹配你的水平</button><span className="tools-hint">覆盖率 90–98% 为 i+1：多数词认识、少量新词，读得动又有收获。</span></div>}
    {displayed.length ? <div className="book-grid">{displayed.map((book) => <article className="book-card glass-panel" key={book.id}>
      <button className="book-cover-button" onClick={() => onOpen(book)} aria-label={`打开《${book.title}》`}><div className={`book-cover${book.coverImage ? ' has-image' : ''}`} style={{ '--accent': book.accent } as React.CSSProperties}>{book.coverImage ? <img className="book-cover-img" src={book.coverImage} alt="" /> : <><span className="cover-kicker">LINGUAFLOW</span><strong>{book.title}</strong><i>{book.author}</i></>}</div></button>
      <div className="book-info"><div className="book-title-row"><h3>{book.title}</h3>{onAddToPlaylist && <button className="icon-button subtle" onClick={() => { setAddBookTarget(book); setNewPlaylistForBook(''); }} aria-label={`把《${book.title}》加入播放列表`}><ListPlus size={15} /></button>}{onSetTags && <button className="icon-button subtle" onClick={() => openTagEditor(book)} aria-label={`给《${book.title}》加标签`}><Tags size={15} /></button>}{onDelete && book.source !== 'sample' && <button className="icon-button subtle" onClick={() => onDelete(book.id)} aria-label={`删除《${book.title}》`}><Trash2 size={15} /></button>}</div><p>{book.author}</p><div className="book-tags">{book.level && <span className="level-badge">{book.level}</span>}<DifficultyBadge book={book} known={knownSet} /><span>{book.chapters.length} 章</span><span>{book.source === 'epub' ? 'EPUB' : book.source === 'pdf' ? 'PDF' : book.source === 'text' ? '文本' : book.level ? '分级' : '样书'}</span>{(book.tags || []).map((tag) => <button className="book-tag" key={tag} onClick={() => setActiveTag(tag)} title={`按「${tag}」筛选`}>{tag}</button>)}</div><div className="book-progress"><ProgressBar value={book.progress} /><span>{book.progress}%</span></div><Button variant="secondary" size="sm" onClick={() => onOpen(book)}><BookOpen size={15} />{book.progress ? '继续阅读' : '开始阅读'}</Button></div>
    </article>)}</div> : <EmptyState icon={<LibraryIcon size={28} />} title={books.length ? '没有找到这本书' : '书架还是空的'} description={books.length ? '换一个关键词，或导入你自己的 EPUB / PDF / 文本。' : '把 EPUB / PDF / 文本拖进来，或选择你的书籍文件夹，开始搭建自己的书架。'} action={<Button onClick={() => { setImportTab('epub'); setImportOpen(true); }}>导入内容</Button>} />}
    {importOpen && <Modal title={importTab === 'epub' ? '导入书籍' : importTab === 'audio' ? '音频/字幕建课' : '粘贴文本'} onClose={() => setImportOpen(false)}>
      <div className="import-tabs segmented" role="group" aria-label="导入方式"><button className={importTab === 'epub' ? 'active' : ''} onClick={() => setImportTab('epub')}>EPUB / PDF 文件</button><button className={importTab === 'text' ? 'active' : ''} onClick={() => setImportTab('text')}>粘贴文本</button><button className={importTab === 'audio' ? 'active' : ''} onClick={() => setImportTab('audio')}><AudioLines size={14} />音频/字幕建课</button></div>
      {importTab === 'epub' ? <div className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => void handleDrop(event)}><div className="drop-icon"><FileUp size={28} /></div><h3>{importing ? (importProgress?.label || '正在提取章节与正文…') : '把 EPUB / PDF / TXT / MD 文件或整个文件夹拖到这里'}</h3><p>支持无 DRM 的 EPUB、带文字层的 PDF（≤ 60MB）与纯文本 / Markdown；可一次导入多本或整个书籍文件夹。扫描版 PDF 无文字层，暂不支持。</p>{importing && importProgress?.phase === 'reading' && <div className="import-progress"><ProgressBar value={importProgress.progress} /><span>{importProgress.progress}%</span></div>}<input ref={fileRef} type="file" multiple accept=".epub,.pdf,.txt,.md,.markdown,application/epub+zip,application/pdf,text/plain,text/markdown" hidden onChange={(event) => void handleFiles(Array.from(event.target.files || []))} /><div className="dropzone-actions"><Button variant="secondary" disabled={importing} onClick={() => fileRef.current?.click()}>{importing ? '正在导入…' : '选择文件'}</Button><Button variant="secondary" disabled={importing} onClick={() => void pickFolder()}><FolderOpen size={16} />选择书籍文件夹</Button></div></div>
      : importTab === 'text' ? <div className="text-import"><label className="field"><span>标题（可选）</span><input value={textTitle} onChange={(event) => setTextTitle(event.target.value)} placeholder="文章 / 书名" /></label><label className="field"><span>正文</span><textarea value={textBody} onChange={(event) => setTextBody(event.target.value)} rows={10} placeholder="粘贴英文文章、新闻、演讲稿或 Markdown…空行分段，# 标题分章。" /></label><Button disabled={importing || !textBody.trim()} onClick={() => void handleText()}>{importing ? '正在导入…' : '导入为可阅读的书'}</Button></div>
      : <Suspense fallback={<p className="muted">正在加载建课工具…</p>}><LessonBuilder onCreated={(book) => { onLessonCreated?.(book); setImportOpen(false); }} /></Suspense>}
      <div className="privacy-note"><strong>Local-first by design</strong><span>解析在浏览器内完成，书籍内容不会离开你的设备。</span></div>
    </Modal>}
    {viewsOpen && <Modal title="保存的视图" eyebrow="SAVED VIEWS" onClose={() => setViewsOpen(false)}><div className="views-modal"><p className="modal-lead">把当前的搜索、排序、筛选与标签组合存成命名视图，下次一键回到同一视角。</p>
      {views && views.length ? <ul className="views-list">{views.map((view) => <li key={view.id} className={viewMatches(view, currentView) ? 'current' : ''}><button className="view-apply" onClick={() => applyView(view)}><Bookmark size={15} /><span>{view.name}</span><small>{[view.tag && `#${view.tag}`, view.sortMode === 'match' && '难度匹配', view.onlyIdeal && '只看 i+1', view.query && `“${view.query}”`].filter(Boolean).join(' · ') || '全部书籍'}</small></button>{onDeleteView && <button className="icon-button subtle" onClick={() => onDeleteView(view.id)} aria-label={`删除视图 ${view.name}`}><Trash2 size={15} /></button>}</li>)}</ul> : <p className="views-empty">还没有保存的视图。设置好筛选后，在下面给它起个名字。</p>}
      {onSaveView && <form className="view-save" onSubmit={(event) => { event.preventDefault(); const name = viewName.trim(); if (!name) return; onSaveView({ name, ...currentView }); setViewName(''); }}><input value={viewName} onChange={(event) => setViewName(event.target.value)} placeholder="视图名称，如「本周 i+1」「科幻 #scifi」" aria-label="视图名称" /><Button type="submit" disabled={!viewName.trim()}><Plus size={15} />保存当前视图</Button></form>}
    </div></Modal>}
    {tagEditBook && <Modal title={`给《${tagEditBook.title}》加标签`} eyebrow="TAGS" onClose={() => setTagEditBook(null)}><div className="tag-modal"><p className="modal-lead">用标签把书归进收藏集（如「科幻」「在读」「待复习」），多个标签用逗号分隔。</p><input className="tag-input" value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} placeholder="科幻，在读 …" aria-label="标签" />
      {tags.length > 0 && <div className="tag-suggestions"><span>快速添加：</span>{tags.map((tag) => <button key={tag} className="filter-chip" onClick={() => setTagDraft((prev) => (parseTags(prev).some((t) => t.toLowerCase() === tag.toLowerCase()) ? prev : [...parseTags(prev), tag].join('，'))) }>{tag}</button>)}</div>}
      <div className="modal-actions"><Button variant="ghost" onClick={() => setTagEditBook(null)}>取消</Button><Button onClick={() => { if (onSetTags) onSetTags(tagEditBook.id, parseTags(tagDraft)); setTagEditBook(null); }}><Tags size={16} />保存标签</Button></div>
    </div></Modal>}
    {playlistsOpen && <Modal title="播放列表" eyebrow="PLAYLISTS" onClose={() => setPlaylistsOpen(false)}><div className="playlists-modal">
      {selectedPlaylist ? <div className="playlist-detail">
        <button className="playlist-back" onClick={() => setSelectedPlaylistId(null)}><ArrowLeft size={15} />全部播放列表</button>
        <label className="field"><span>名称</span><input value={selectedPlaylist.name} onChange={(event) => onRenamePlaylist?.(selectedPlaylist.id, event.target.value)} aria-label="播放列表名称" /></label>
        <div className="playlist-detail-actions"><Button disabled={!resolvePlaylistBooks(selectedPlaylist, books).length} onClick={() => { setPlayerPlaylist(selectedPlaylist); setPlaylistsOpen(false); }}><Play size={16} />连续播放</Button><span className="muted">{resolvePlaylistBooks(selectedPlaylist, books).length} 首 · 无音频的书会自动跳过</span></div>
        {resolvePlaylistBooks(selectedPlaylist, books).length ? <ul className="playlist-tracks">{resolvePlaylistBooks(selectedPlaylist, books).map((book, index) => <li key={book.id}><span className="track-index">{index + 1}</span><span className="track-title">{book.title}</span><span className="track-actions"><button className="icon-button subtle" disabled={index === 0} onClick={() => moveTrack(selectedPlaylist, index, index - 1)} aria-label={`上移 ${book.title}`}><ChevronUp size={15} /></button><button className="icon-button subtle" disabled={index === selectedPlaylist.bookIds.length - 1} onClick={() => moveTrack(selectedPlaylist, index, index + 1)} aria-label={`下移 ${book.title}`}><ChevronDown size={15} /></button><button className="icon-button subtle" onClick={() => onRemoveFromPlaylist?.(selectedPlaylist.id, book.id)} aria-label={`从播放列表移除 ${book.title}`}><Trash2 size={15} /></button></span></li>)}</ul> : <p className="views-empty">这个播放列表还是空的。在书卡上点「加入播放列表」把带音频的书/课程加进来。</p>}
      </div> : <div className="playlist-list-view">
        <p className="modal-lead">把多本带音频的书或课程排成队列，连续播放——通勤、睡前磨耳朵，不用一本本手动切。</p>
        {playlists && playlists.length ? <ul className="views-list playlist-list">{playlists.map((playlist) => <li key={playlist.id}><button className="view-apply" onClick={() => setSelectedPlaylistId(playlist.id)}><ListMusic size={15} /><span>{playlist.name}</span><small>{playlist.bookIds.length} 首</small></button><button className="icon-button subtle" disabled={!playlist.bookIds.length} onClick={() => { setPlayerPlaylist(playlist); setPlaylistsOpen(false); }} aria-label={`播放 ${playlist.name}`}><Play size={15} /></button>{onDeletePlaylist && <button className="icon-button subtle" onClick={() => onDeletePlaylist(playlist.id)} aria-label={`删除播放列表 ${playlist.name}`}><Trash2 size={15} /></button>}</li>)}</ul> : <p className="views-empty">还没有播放列表。在下面起个名字创建第一个，比如「睡前听力」「本周课程」。</p>}
        {onCreatePlaylist && <form className="view-save" onSubmit={(event) => { event.preventDefault(); const name = playlistName.trim(); if (!name) return; onCreatePlaylist(name); setPlaylistName(''); }}><input value={playlistName} onChange={(event) => setPlaylistName(event.target.value)} placeholder="播放列表名称，如「睡前听力」" aria-label="播放列表名称" /><Button type="submit" disabled={!playlistName.trim()}><Plus size={15} />创建播放列表</Button></form>}
      </div>}
    </div></Modal>}
    {addBookTarget && <Modal title={`把《${addBookTarget.title}》加入播放列表`} eyebrow="ADD TO PLAYLIST" onClose={() => setAddBookTarget(null)}><div className="playlist-chooser">
      {playlists && playlists.length ? <ul className="views-list playlist-list">{playlists.map((playlist) => <li key={playlist.id}><button className="view-apply" onClick={() => { onAddToPlaylist?.(playlist.id, addBookTarget.id); setAddBookTarget(null); }}><ListMusic size={15} /><span>{playlist.name}</span><small>{playlist.bookIds.includes(addBookTarget.id) ? '已在列表' : `${playlist.bookIds.length} 首`}</small></button></li>)}</ul> : <p className="views-empty">还没有播放列表。在下面创建一个并立即加入这本书。</p>}
      {onCreatePlaylist && <form className="view-save" onSubmit={(event) => { event.preventDefault(); const name = newPlaylistForBook.trim(); if (!name) return; const id = onCreatePlaylist(name); onAddToPlaylist?.(id, addBookTarget.id); setAddBookTarget(null); }}><input value={newPlaylistForBook} onChange={(event) => setNewPlaylistForBook(event.target.value)} placeholder="新建播放列表名称" aria-label="新建播放列表名称" /><Button type="submit" disabled={!newPlaylistForBook.trim()}><Plus size={15} />创建并加入</Button></form>}
    </div></Modal>}
    {playerPlaylist && <Modal title={`连续播放 · ${playerPlaylist.name}`} eyebrow="NOW PLAYING" onClose={() => setPlayerPlaylist(null)}><Suspense fallback={<p className="muted">正在加载播放器…</p>}><PlaylistPlayer books={playerBooks} onOpenBook={(book) => { setPlayerPlaylist(null); onOpen(book); }} /></Suspense></Modal>}
  </div>;
}
