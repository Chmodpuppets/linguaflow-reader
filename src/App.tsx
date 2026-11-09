import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import AppShell from './components/AppShell';
import Library from './components/Library';
import Vocabulary from './components/Vocabulary';
import Review from './components/Review';
import Notes from './components/Notes';
import Settings from './components/Settings';
import { initialData } from './data/initialData';
import { loadBuiltinBooks } from './data/builtinBooks';
import { deleteAlignment, deleteBookAudio, loadData, saveData, saveVoiceAudio } from './lib/db';
import { notifyBookAudioChanged } from './lib/bookAudio';
import { clearAlignment } from './lib/audioAlign';
import type { ImportProgress } from './lib/epub';
import { downloadJson, makeId } from './lib/utils';
import type { AppData, Book, Highlight, Page, ReaderSettings, ReviewLog, VocabEntry, VoiceRecord } from './types';

// 阅读器只在一本书被打开时才需要；口语实验室/统计同理。
// 拆成独立 chunk 后，首页只下载书库 + 词汇 + 外壳，首屏从 682KB 降到百来 KB 量级。
const Reader = lazy(() => import('./components/Reader'));
const VoiceLab = lazy(() => import('./components/VoiceLab'));
const VoiceAnalytics = lazy(() => import('./components/VoiceAnalytics'));

type NewVocab = Omit<VocabEntry, 'id' | 'createdAt' | 'familiarity' | 'dueAt' | 'reviewCount'>;
type NewHighlight = Omit<Highlight, 'id' | 'createdAt'>;

// 内置书（sample）的正文内容在代码里静态存在，持久化时剥离，加载时从这还原，
// 避免每次翻页都把整本书（含 OCR 块）序列化进 IndexedDB 导致卡顿。
// 轻量样书随主包同步就位；扫描书由 builtinBooks 的动态 chunk 到位后补齐。
const STATIC_CONTENT = new Map<string, Book>(initialData.books.map((book) => [book.id, book] as const));

// EPUB 会整份解包进内存：超过 30MB 先确认，超过 60MB 直接拒绝，避免大书把浏览器拖垮。
const WARN_EPUB_BYTES = 30 * 1024 * 1024;
const MAX_EPUB_BYTES = 60 * 1024 * 1024;

function registerStaticBooks(books: Book[]) {
  for (const book of books) STATIC_CONTENT.set(book.id, book);
}

function slimForStorage(books: Book[]): Book[] {
  return books.map((book) => {
    if (book.source !== 'sample' || !STATIC_CONTENT.has(book.id)) return book;
    const { chapters: _c, pageImages: _p, pageBlocks: _b, audio: _a, ...rest } = book;
    return rest as Book;
  });
}

function hydrateBooks(books: Book[]): Book[] {
  return books.map((book) => {
    const full = STATIC_CONTENT.get(book.id);
    // 扫描书的正文是异步 chunk：还没到位时先给个空壳，保证书库列表不会因缺 chapters 崩溃
    if (!full) return Array.isArray(book.chapters) ? book : { ...book, chapters: [] };
    // 以静态书打底（保证默认字段齐全），再用持久化数据覆盖（保留用户改过的元数据），
    // 最后把 slimForStorage 剥掉的 4 个大字段补回来。老写法只用 6 个字段重建，
    // 会把 accent / cover / description 等自定义值悄悄丢掉。
    return {
      ...full, ...book,
      chapters: full.chapters,
      pageImages: full.pageImages,
      pageBlocks: full.pageBlocks,
      audio: full.audio,
    };
  });
}

export default function App() {
  const [data, setData] = useState<AppData>(initialData);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<Page>('library');
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [toast, setToast] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const saveTimer = useRef<number | null>(null);
  const activeBook = data.books.find((book) => book.id === activeBookId) || null;
  const savedWords = useMemo(() => data.vocabulary.map((entry) => entry.word), [data.vocabulary]);
  const dueCount = data.vocabulary.filter((entry) => new Date(entry.dueAt).getTime() <= Date.now()).length;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // 第一阶段：只等 IndexedDB + 轻量样书，首屏立刻可用
        const stored = await loadData();
        if (cancelled) return;
        if (stored) {
          const migrated: AppData = {
            ...stored,
            books: hydrateBooks(stored.books),
            vocabulary: stored.vocabulary.map((entry) => ({ ...entry, spokenCount: entry.spokenCount || 0 })),
            voiceRecords: stored.voiceRecords || [],
          };
          // 老数据里可能没有后来新增的内置书：按 id 补齐，不动用户的词汇/笔记/进度
          const missing = initialData.books.filter((book) => !migrated.books.some((existing) => existing.id === book.id));
          setData(missing.length ? { ...migrated, books: [...migrated.books, ...missing] } : migrated);
        }
      } catch {
        // 本地数据损坏 / IndexedDB 被禁用时，绝不能让 setReady 被跳过（否则永久 loading）。
        if (!cancelled) {
          setToast('本地数据读取失败，已打开一个干净的阅读空间');
          window.setTimeout(() => setToast(''), 3200);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
      if (cancelled) return;
      if (navigator.storage?.persist) void navigator.storage.persist();

      // 第二阶段：本机可选书籍走 fetch('/local-content/*.json')，不阻塞首屏；
      // 文件不存在时 loadBuiltinBooks() 已安静降级为轻量样书，这里只负责补进书库。
      try {
        const builtin = await loadBuiltinBooks();
        if (cancelled) return;
        registerStaticBooks(builtin);
        setData((current) => {
          const hydrated = hydrateBooks(current.books);
          const missing = builtin.filter((book) => !hydrated.some((existing) => existing.id === book.id));
          return { ...current, books: missing.length ? [...hydrated, ...missing] : hydrated };
        });
      } catch {
        // 兜底：即使可选加载抛错也保留样书可读，不打断用户
      }
    })();
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => { cancelled = true; window.removeEventListener('online', updateOnline); window.removeEventListener('offline', updateOnline); };
  }, []);

  useEffect(() => {
    if (!ready) return;
    // 只存瘦身后的书 + 防抖，翻页/标记不再整本书序列化
    const snapshot = { ...data, books: slimForStorage(data.books) };
    // 双通道（IndexedDB + localStorage）都写失败时给用户一句话，不再静默吞掉。
    const persist = () => { void saveData(snapshot).catch(() => {
      setToast('本地数据保存失败，请检查浏览器存储空间或配额');
      window.setTimeout(() => setToast(''), 3200);
    }); };
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(persist, 400);
    const flush = () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); persist(); };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [data, ready]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3200);
  };
  const updateBook = (id: string, update: Partial<Book>) => setData((current) => ({ ...current, books: current.books.map((book) => book.id === id ? { ...book, ...update } : book) }));
  const updateSettings = (settings: Partial<ReaderSettings>) => setData((current) => ({ ...current, settings: { ...current.settings, ...settings } }));
  const openBook = (book: Book) => {
    // 本机可选书籍的正文来自 fetch('/local-content/*.json')；没到位时给一句人话而不是空白页
    if (book.source === 'sample' && !book.chapters?.length) { notify('这本原书的正文还在解压，稍等一下下…'); return; }
    setActiveBookId(book.id); setPage('library');
  };
  const openSource = (item: { bookId: string; chapterId: string; paragraphIndex: number }) => {
    const book = data.books.find((candidate) => candidate.id === item.bookId);
    if (!book) { notify('来源书籍已经不在当前书库'); return; }
    const chapterIndex = Math.max(0, book.chapters.findIndex((chapter) => chapter.id === item.chapterId));
    updateBook(book.id, { currentChapter: chapterIndex, currentParagraph: item.paragraphIndex, lastReadAt: new Date().toISOString() });
    setActiveBookId(book.id);
    setPage('library');
  };
  const addVocab = (entry: NewVocab) => setData((current) => ({ ...current, vocabulary: [{ ...entry, id: makeId('vocab'), createdAt: new Date().toISOString(), familiarity: 0, dueAt: new Date().toISOString(), reviewCount: 0 }, ...current.vocabulary] }));
  const addHighlight = (highlight: NewHighlight) => setData((current) => ({ ...current, highlights: [{ ...highlight, id: makeId('mark'), createdAt: new Date().toISOString() }, ...current.highlights] }));
  const deleteVocab = (id: string) => { if (window.confirm('确定删除这个词条吗？原文和复习记录也会从词汇本移除。')) setData((current) => ({ ...current, vocabulary: current.vocabulary.filter((entry) => entry.id !== id), reviewLogs: current.reviewLogs.filter((log) => log.vocabId !== id) })); };
  const deleteBook = (id: string) => {
    const book = data.books.find((item) => item.id === id);
    // 内置样书来自 STATIC_CONTENT，删了下次 hydrate 又会回来，只允许删自己导入的 EPUB。
    if (!book || book.source !== 'epub') return;
    if (!window.confirm(`确定删除《${book.title}》吗？这本书的笔记、词条、复习记录和练习记录也会一并移除。`)) return;
    setData((current) => {
      const removedVocabIds = new Set(current.vocabulary.filter((entry) => entry.bookId === id).map((entry) => entry.id));
      return {
        ...current,
        books: current.books.filter((item) => item.id !== id),
        vocabulary: current.vocabulary.filter((entry) => entry.bookId !== id),
        highlights: current.highlights.filter((item) => item.bookId !== id),
        reviewLogs: current.reviewLogs.filter((log) => !removedVocabIds.has(log.vocabId)),
        voiceRecords: current.voiceRecords.filter((record) => record.bookId !== id),
      };
    });
    // 级联清掉 IndexedDB 里为这本书绑定的音频与句级对齐，避免留下孤儿 Blob。
    void deleteBookAudio(id).catch(() => undefined);
    void deleteAlignment(id).catch(() => undefined);
    clearAlignment(id);
    notifyBookAudioChanged(id);
    if (activeBookId === id) { setActiveBookId(null); setPage('library'); }
    notify(`已删除《${book.title}》`);
  };
  const deleteHighlight = (id: string) => setData((current) => ({ ...current, highlights: current.highlights.filter((item) => item.id !== id) }));
  const saveVoiceRecord = async (record: VoiceRecord, audio: Blob) => {
    // 先确保录音 Blob 落盘，再计入统计：写失败时不产生「有记录无音频」的孤儿。
    try {
      await saveVoiceAudio(record.id, audio);
      setData((current) => ({ ...current, voiceRecords: [record, ...current.voiceRecords.filter((item) => item.id !== record.id)] }));
    } catch {
      notify('录音文件保存失败，本次练习未计入统计，请检查浏览器存储空间');
    }
  };
  const activateSpokenWord = (word: string) => setData((current) => ({
    ...current,
    vocabulary: current.vocabulary.map((entry) => entry.word.toLowerCase() === word.toLowerCase() ? { ...entry, spokenCount: (entry.spokenCount || 0) + 1, lastSpokenAt: new Date().toISOString() } : entry),
  }));
  const addReview = (entry: VocabEntry, result: ReviewLog['result'], mode: ReviewLog['mode']) => {
    const increments = { again: 0, hard: 1, good: 2, easy: 3 };
    const days = { again: 0, hard: 1, good: 3, easy: 7 };
    setData((current) => ({
      ...current,
      vocabulary: current.vocabulary.map((item) => item.id === entry.id ? { ...item, familiarity: Math.max(0, Math.min(4, result === 'again' ? 0 : item.familiarity + increments[result])), dueAt: new Date(Date.now() + days[result] * 86400000).toISOString(), reviewCount: item.reviewCount + 1 } : item),
      reviewLogs: [{ id: makeId('review'), vocabId: entry.id, result, mode, createdAt: new Date().toISOString() }, ...current.reviewLogs],
    }));
  };
  const importBook = async (file: File) => {
    if (file.size > MAX_EPUB_BYTES) {
      const message = `文件 ${(file.size / 1048576).toFixed(0)}MB 超过 60MB 上限：EPUB 会整份解包进内存，请先拆分或换体积更小的版本。`;
      notify(message);
      throw new Error(message);
    }
    if (file.size > WARN_EPUB_BYTES && !window.confirm(`这个文件有 ${(file.size / 1048576).toFixed(0)}MB，解析会较慢并占用内存。继续导入吗？`)) return;
    setImporting(true);
    setImportProgress({ phase: 'reading', progress: 0, label: '准备读取文件…' });
    try {
      const { importEpub } = await import('./lib/epub');
      const book = await importEpub(file, setImportProgress);
      setData((current) => ({ ...current, books: [book, ...current.books] }));
      setActiveBookId(book.id);
      notify(`已导入《${book.title}》，共 ${book.chapters.length} 个章节`);
    } catch (error) { notify(error instanceof Error ? error.message : 'EPUB 导入失败，请检查文件。'); throw error; }
    finally { setImporting(false); setImportProgress(null); }
  };
  const restore = (restored: AppData) => {
    setData({ ...restored, books: hydrateBooks(restored.books), reviewLogs: restored.reviewLogs || [], highlights: restored.highlights || [], voiceRecords: restored.voiceRecords || [] });
    setActiveBookId(null);
    setPage('library');
    notify('备份已恢复，欢迎回到你的阅读空间');
  };

  if (!ready) return <div className="loading-screen"><img src="/linguaflow-icon.png" alt="LinguaFlow" /><div className="loading-line"><span /></div><p>正在打开你的本地阅读空间…</p></div>;

  let content: React.ReactNode;
  if (activeBook) content = <Reader book={activeBook} settings={data.settings} highlights={data.highlights} savedWords={savedWords} onBack={() => setActiveBookId(null)} onUpdateBook={updateBook} onSettings={updateSettings} onAddVocab={addVocab} onAddHighlight={addHighlight} onSaveVoice={saveVoiceRecord} onNotify={notify} />;
  else if (page === 'library') content = <Library books={data.books} onOpen={openBook} onImport={importBook} onDelete={deleteBook} importing={importing} importProgress={importProgress} />;
  else if (page === 'vocabulary') content = <Vocabulary entries={data.vocabulary} onOpenSource={openSource} onReview={() => setPage('review')} onDelete={deleteVocab} />;
  else if (page === 'review') content = <Review entries={data.vocabulary} onReview={addReview} onBack={() => setPage('library')} />;
  else if (page === 'voice-lab') content = <VoiceLab books={data.books} highlights={data.highlights} vocabulary={data.vocabulary} voiceRecords={data.voiceRecords} onSave={saveVoiceRecord} onActivateWord={activateSpokenWord} onOpenAnalytics={() => setPage('voice-analytics')} />;
  else if (page === 'voice-analytics') content = <VoiceAnalytics records={data.voiceRecords} vocabulary={data.vocabulary} onPractice={() => setPage('voice-lab')} />;
  else if (page === 'notes') content = <Notes highlights={data.highlights} books={data.books} onOpenSource={openSource} onDelete={deleteHighlight} />;
  else content = <Settings settings={data.settings} data={data} books={data.books} storageReady={ready} onSettings={updateSettings} onExport={() => downloadJson(`linguaflow-reader-${new Date().toISOString().slice(0, 10)}.json`, data)} onImport={restore} onNotify={notify} />;

  return <div className={data.settings.reducedAmbient ? 'reduce-ambient' : ''}><AppShell page={page} onNavigate={(target) => { setActiveBookId(null); setPage(target); }} vocabCount={data.vocabulary.length} dueCount={dueCount} online={online}><Suspense fallback={<div className="route-loading"><div className="loading-line"><span /></div><p>正在载入…</p></div>}>{content}</Suspense></AppShell>{toast && <div className="toast glass-panel"><CheckCircle2 size={18} /><span>{toast}</span></div>}</div>;
}
