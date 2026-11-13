import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import AppShell from './components/AppShell';
import { ConfirmDialog } from './components/UI';
import Library from './components/Library';
import { initialData } from './data/initialData';
import { loadBuiltinBooks } from './data/builtinBooks';
import { deleteAlignment, deleteBookAudio, getStorageChannel, loadData, saveData, saveVoiceAudio, type StorageChannel } from './lib/db';
import { notifyBookAudioChanged } from './lib/bookAudio';
import { clearAlignment } from './lib/audioAlign';
import type { ImportProgress } from './lib/epub';
import { downloadJson, makeId } from './lib/utils';
import { getCachedKnownWords, isSyncEnabled, knownWordsStale, recordEvent, refreshKnownWords, startLearningSync } from './lib/learning';
import { computeStreak, todayActions, wordStateCounts } from './lib/streak';
import type { AppData, Book, Highlight, Page, ReaderSettings, ReviewLog, SavedSentence, VocabEntry, VoiceRecord, WordGloss, WordState } from './types';

// 阅读器只在一本书被打开时才需要；口语实验室/统计同理。
// 拆成独立 chunk 后，首页只下载书库 + 词汇 + 外壳，首屏从 682KB 降到百来 KB 量级。
const Reader = lazy(() => import('./components/Reader'));
const VoiceLab = lazy(() => import('./components/VoiceLab'));
const VoiceAnalytics = lazy(() => import('./components/VoiceAnalytics'));
// 首屏只需要同步的书库；其余页面按需加载，进一步瘦身主包。
const Vocabulary = lazy(() => import('./components/Vocabulary'));
const Review = lazy(() => import('./components/Review'));
const Notes = lazy(() => import('./components/Notes'));
const Settings = lazy(() => import('./components/Settings'));

type NewVocab = Omit<VocabEntry, 'id' | 'createdAt' | 'familiarity' | 'dueAt' | 'reviewCount'>;
type NewHighlight = Omit<Highlight, 'id' | 'createdAt'>;
type NewSentence = Omit<SavedSentence, 'id' | 'createdAt'>;

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
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [storageChannel, setStorageChannel] = useState<StorageChannel>('indexeddb');
  const saveTimer = useRef<number | null>(null);
  const toastTimer = useRef(0);
  // 应用内确认弹窗（替代原生 confirm）：askConfirm 返回 Promise，ESC/遮罩/取消都 resolve(false)。
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; confirmLabel?: string; danger?: boolean; resolve: (ok: boolean) => void } | null>(null);
  const activeBook = data.books.find((book) => book.id === activeBookId) || null;
  const savedWords = useMemo(() => data.vocabulary.map((entry) => entry.word), [data.vocabulary]);
  const dueCount = data.vocabulary.filter((entry) => new Date(entry.dueAt).getTime() <= Date.now()).length;

  // P3 难度匹配：已知词 = pathmora 积累（sync 缓存）∪ 本地已 demonstrated 的词。
  const [syncKnown, setSyncKnown] = useState<string[]>(() => getCachedKnownWords());
  const knownWords = useMemo(() => {
    const goodIds = new Set(data.reviewLogs.filter((log) => log.result === 'good' || log.result === 'easy').map((log) => log.vocabId));
    const local = data.vocabulary.filter((entry) => goodIds.has(entry.id) || entry.familiarity >= 3).map((entry) => entry.word);
    return Array.from(new Set([...local, ...syncKnown].map((word) => word.toLowerCase())));
  }, [data.vocabulary, data.reviewLogs, syncKnown]);

  // 学习记录上云（opt-in）：联网恢复 / 周期补传离线队列。未开启同步时不做任何事。
  useEffect(() => { startLearningSync(); }, []);
  // 开启同步且缓存过期时刷新已知词（供难度匹配）；回到书库时再检查，连接账号后即刻生效。
  // 不可达保留缓存 / 本地回退。
  useEffect(() => {
    if (page !== 'library' || !isSyncEnabled() || !knownWordsStale()) return;
    let cancelled = false;
    void refreshKnownWords().then((words) => { if (!cancelled && words) setSyncKnown(words); });
    return () => { cancelled = true; };
  }, [page]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // 第一阶段：只等 IndexedDB + 轻量样书，首屏立刻可用
        const stored = await loadData();
        if (cancelled) return;
        setStorageChannel(getStorageChannel());
        if (stored) {
          const migrated: AppData = {
            ...stored,
            books: hydrateBooks(stored.books),
            vocabulary: stored.vocabulary.map((entry) => ({ ...entry, spokenCount: entry.spokenCount || 0 })),
            voiceRecords: stored.voiceRecords || [],
            sentences: stored.sentences || [],
            wordStates: stored.wordStates || {},
            glosses: stored.glosses || {},
          };
          // 老数据里可能没有后来新增的内置书：按 id 补齐，不动用户的词汇/笔记/进度
          const missing = initialData.books.filter((book) => !migrated.books.some((existing) => existing.id === book.id));
          setData(missing.length ? { ...migrated, books: [...migrated.books, ...missing] } : migrated);
        }
      } catch {
        // 本地数据损坏 / IndexedDB 被禁用时，绝不能让 setReady 被跳过（否则永久 loading）。
        if (!cancelled) {
          setStorageChannel('none');
          notify('本地数据读取失败，已打开一个干净的阅读空间', 'error');
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
    const persist = () => { void saveData(snapshot).then(() => {
      setStorageChannel(getStorageChannel());
    }).catch(() => {
      setStorageChannel(getStorageChannel());
      notify('本地数据保存失败，请检查浏览器存储空间或配额', 'error');
    }); };
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(persist, 400);
    const flush = () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); persist(); };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [data, ready]);

  // 清掉上一条的定时器：否则前一条的 3200ms 到期会提前清掉后一条 toast。
  const notify = (message: string, tone: 'success' | 'error' = 'success') => {
    window.clearTimeout(toastTimer.current);
    setToast({ message, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  };
  const askConfirm = (options: { title: string; message: string; confirmLabel?: string; danger?: boolean }) => new Promise<boolean>((resolve) => { setConfirmState({ ...options, resolve }); });
  const closeConfirm = (ok: boolean) => { confirmState?.resolve(ok); setConfirmState(null); };
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
  const addSentence = (sentence: NewSentence) => {
    recordEvent({ type: 'save_sentence', word: sentence.word, bookId: sentence.bookId, payload: { text: sentence.text, meaning: sentence.meaning, chapterTitle: sentence.chapterTitle } });
    setData((current) => ({ ...current, sentences: [{ ...sentence, id: makeId('sentence'), createdAt: new Date().toISOString() }, ...(current.sentences || [])] }));
  };
  const deleteSentence = async (id: string) => {
    const ok = await askConfirm({ title: '删除收藏句子', message: '确定从句子收藏里移除这句话吗？', confirmLabel: '删除', danger: true });
    if (ok) setData((current) => ({ ...current, sentences: (current.sentences || []).filter((item) => item.id !== id) }));
  };
  // 词状态 + 常驻注音释义缓存：标记学习中/已掌握时写入，阅读页据此渲染 ruby 与覆盖率。
  const setWordState = (word: string, state: WordState, gloss?: WordGloss) => setData((current) => ({
    ...current,
    wordStates: { ...(current.wordStates || {}), [word]: state },
    glosses: gloss ? { ...(current.glosses || {}), [word]: gloss } : (current.glosses || {}),
  }));
  const deleteVocab = async (id: string) => {
    const ok = await askConfirm({ title: '删除词条', message: '确定删除这个词条吗？原文和复习记录也会从词汇本移除。', confirmLabel: '删除', danger: true });
    if (ok) setData((current) => ({ ...current, vocabulary: current.vocabulary.filter((entry) => entry.id !== id), reviewLogs: current.reviewLogs.filter((log) => log.vocabId !== id) }));
  };
  const deleteBook = async (id: string) => {
    const book = data.books.find((item) => item.id === id);
    // 内置样书来自 STATIC_CONTENT，删了下次 hydrate 又会回来，只允许删自己导入的 EPUB / 文本。
    if (!book || (book.source !== 'epub' && book.source !== 'text')) return;
    const ok = await askConfirm({ title: '删除书籍', message: `确定删除《${book.title}》吗？这本书的笔记、词条、复习记录和练习记录也会一并移除。`, confirmLabel: '删除', danger: true });
    if (!ok) return;
    setData((current) => {
      const removedVocabIds = new Set(current.vocabulary.filter((entry) => entry.bookId === id).map((entry) => entry.id));
      return {
        ...current,
        books: current.books.filter((item) => item.id !== id),
        vocabulary: current.vocabulary.filter((entry) => entry.bookId !== id),
        highlights: current.highlights.filter((item) => item.bookId !== id),
        reviewLogs: current.reviewLogs.filter((log) => !removedVocabIds.has(log.vocabId)),
        voiceRecords: current.voiceRecords.filter((record) => record.bookId !== id),
        sentences: (current.sentences || []).filter((item) => item.bookId !== id),
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
  // 返回落盘结果：VoiceRecorder 据此决定是否显示「已保存」，写失败不再谎报成功。
  const saveVoiceRecord = async (record: VoiceRecord, audio: Blob): Promise<boolean> => {
    // 先确保录音 Blob 落盘，再计入统计：写失败时不产生「有记录无音频」的孤儿。
    try {
      await saveVoiceAudio(record.id, audio);
      setData((current) => ({ ...current, voiceRecords: [record, ...current.voiceRecords.filter((item) => item.id !== record.id)] }));
      recordEvent({ type: 'shadow', bookId: record.bookId, payload: { accuracy: record.metrics.accuracy, wpm: record.metrics.wpm, wordCount: record.metrics.wordCount, duration: record.metrics.duration } });
      return true;
    } catch {
      notify('录音文件保存失败，本次练习未计入统计，请检查浏览器存储空间', 'error');
      return false;
    }
  };
  const activateSpokenWord = (word: string) => setData((current) => ({
    ...current,
    vocabulary: current.vocabulary.map((entry) => entry.word.toLowerCase() === word.toLowerCase() ? { ...entry, spokenCount: (entry.spokenCount || 0) + 1, lastSpokenAt: new Date().toISOString() } : entry),
  }));
  const addReview = (entry: VocabEntry, result: ReviewLog['result'], mode: ReviewLog['mode']) => {
    recordEvent({ type: 'review', word: entry.word, bookId: entry.bookId, payload: { result, mode } });
    const increments = { again: 0, hard: 1, good: 2, easy: 3 };
    const days = { again: 0, hard: 1, good: 3, easy: 7 };
    setData((current) => ({
      ...current,
      vocabulary: current.vocabulary.map((item) => item.id === entry.id ? { ...item, familiarity: Math.max(0, Math.min(4, result === 'again' ? 0 : item.familiarity + increments[result])), dueAt: new Date(Date.now() + days[result] * 86400000).toISOString(), reviewCount: item.reviewCount + 1 } : item),
      reviewLogs: [{ id: makeId('review'), vocabId: entry.id, result, mode, createdAt: new Date().toISOString() }, ...current.reviewLogs],
    }));
  };
  // LingQ 式「导入任何文本」：粘贴文章 / .txt / .md → 可阅读、可注音、可统计的书。
  const importText = async (title: string, text: string) => {
    setImporting(true);
    try {
      const { buildBookFromText } = await import('./lib/textBook');
      const book = buildBookFromText(title, '', text, makeId('book'));
      setData((current) => ({ ...current, books: [book, ...current.books] }));
      setActiveBookId(book.id);
      notify(`已导入《${book.title}》，共 ${book.chapters.length} 个章节`);
    } catch (error) { notify(error instanceof Error ? error.message : '文本导入失败，请检查内容。', 'error'); throw error; }
    finally { setImporting(false); }
  };
  const importBook = async (file: File) => {
    const isText = /\.(txt|md|markdown)$/i.test(file.name) || file.type === 'text/plain' || file.type === 'text/markdown';
    if (isText) { await importText(file.name.replace(/\.(txt|md|markdown)$/i, ''), await file.text()); return; }
    if (file.size > MAX_EPUB_BYTES) {
      const message = `文件 ${(file.size / 1048576).toFixed(0)}MB 超过 60MB 上限：EPUB 会整份解包进内存，请先拆分或换体积更小的版本。`;
      notify(message);
      throw new Error(message);
    }
    if (file.size > WARN_EPUB_BYTES) {
      const ok = await askConfirm({ title: '导入大文件', message: `这个文件有 ${(file.size / 1048576).toFixed(0)}MB，解析会较慢并占用内存。继续导入吗？`, confirmLabel: '继续导入' });
      if (!ok) return;
    }
    setImporting(true);
    setImportProgress({ phase: 'reading', progress: 0, label: '准备读取文件…' });
    try {
      const { importEpub } = await import('./lib/epub');
      const book = await importEpub(file, setImportProgress);
      setData((current) => ({ ...current, books: [book, ...current.books] }));
      setActiveBookId(book.id);
      notify(`已导入《${book.title}》，共 ${book.chapters.length} 个章节`);
    } catch (error) { notify(error instanceof Error ? error.message : 'EPUB 导入失败，请检查文件。', 'error'); throw error; }
    finally { setImporting(false); setImportProgress(null); }
  };
  const restore = (restored: AppData) => {
    setData({ ...restored, books: hydrateBooks(restored.books), reviewLogs: restored.reviewLogs || [], highlights: restored.highlights || [], voiceRecords: restored.voiceRecords || [], sentences: restored.sentences || [], wordStates: restored.wordStates || {}, glosses: restored.glosses || {} });
    setActiveBookId(null);
    setPage('library');
    notify('备份已恢复，欢迎回到你的阅读空间');
  };

  if (!ready) return <div className="loading-screen"><img src="/linguaflow-icon.png" alt="LinguaFlow" /><div className="loading-line"><span /></div><p>正在打开你的本地阅读空间…</p></div>;

  let content: React.ReactNode;
  if (activeBook) content = <Reader book={activeBook} settings={data.settings} highlights={data.highlights} savedWords={savedWords} sentences={data.sentences || []} wordStates={data.wordStates || {}} glosses={data.glosses || {}} onBack={() => setActiveBookId(null)} onUpdateBook={updateBook} onSettings={updateSettings} onAddVocab={addVocab} onAddHighlight={addHighlight} onAddSentence={addSentence} onSetWordState={setWordState} onSaveVoice={saveVoiceRecord} onNotify={notify} />;
  else if (page === 'library') content = <Library books={data.books} knownWords={knownWords} onOpen={openBook} onImport={importBook} onImportText={importText} onDelete={deleteBook} importing={importing} importProgress={importProgress} stats={{ ...wordStateCounts(data), streak: computeStreak(data), today: todayActions(data), goal: data.settings.dailyGoal ?? 5 }} onGoal={(goal) => updateSettings({ dailyGoal: goal })} />;
  else if (page === 'vocabulary') content = <Vocabulary entries={data.vocabulary} onOpenSource={openSource} onReview={() => setPage('review')} onDelete={deleteVocab} />;
  else if (page === 'review') content = <Review entries={data.vocabulary} onReview={addReview} onBack={() => setPage('library')} />;
  else if (page === 'voice-lab') content = <VoiceLab books={data.books} highlights={data.highlights} vocabulary={data.vocabulary} voiceRecords={data.voiceRecords} onSave={saveVoiceRecord} onActivateWord={activateSpokenWord} onOpenAnalytics={() => setPage('voice-analytics')} />;
  else if (page === 'voice-analytics') content = <VoiceAnalytics records={data.voiceRecords} vocabulary={data.vocabulary} onPractice={() => setPage('voice-lab')} />;
  else if (page === 'notes') content = <Notes highlights={data.highlights} sentences={data.sentences || []} books={data.books} onOpenSource={openSource} onDelete={deleteHighlight} onDeleteSentence={deleteSentence} />;
  else content = <Settings settings={data.settings} data={data} books={data.books} storageChannel={storageChannel} onSettings={updateSettings} onExport={() => {
    // 恢复上限是 20MB：导出超限时先提醒，避免「自己的备份恢复不回来」。
    const bytes = JSON.stringify(data).length;
    if (bytes > 20 * 1024 * 1024) notify(`备份约 ${(bytes / 1048576).toFixed(0)}MB，超过 20MB 恢复上限，建议先清理大书再导出`, 'error');
    downloadJson(`linguaflow-reader-${new Date().toISOString().slice(0, 10)}.json`, data);
  }} onImport={restore} onNotify={notify} />;

  return <div className={data.settings.reducedAmbient ? 'reduce-ambient' : ''}><AppShell page={page} onNavigate={(target) => { setActiveBookId(null); setPage(target); }} vocabCount={data.vocabulary.length} dueCount={dueCount} online={online}><Suspense fallback={<div className="route-loading"><div className="loading-line"><span /></div><p>正在载入…</p></div>}>{content}</Suspense></AppShell>{confirmState && <ConfirmDialog title={confirmState.title} message={confirmState.message} confirmLabel={confirmState.confirmLabel} danger={confirmState.danger} onConfirm={() => closeConfirm(true)} onCancel={() => closeConfirm(false)} />}{toast && <div className={`toast glass-panel ${toast.tone === 'error' ? 'toast-error' : ''}`} role="status" aria-live="polite">{toast.tone === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}<span>{toast.message}</span></div>}</div>;
}
