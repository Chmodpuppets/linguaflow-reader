import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Undo2 } from 'lucide-react';
import AppShell from './components/AppShell';
import { ConfirmDialog } from './components/UI';
import Library from './components/Library';
import { initialData } from './data/initialData';
import { gradedGlosses } from './data/gradedReaders';
import { loadBuiltinBooks } from './data/builtinBooks';
import { deleteAlignment, deleteBookAudio, getStorageChannel, loadData, saveData, saveVoiceAudio, subscribeExternalSave, type StorageChannel } from './lib/db';
import { mergeRecentAdds } from './lib/dataMerge';
import { LF_EXT_SOURCE, mergeImportedItems, type ExtensionImportAck } from './lib/extensionImport';
import { notifyBookAudioChanged } from './lib/bookAudio';
import { clearAlignment } from './lib/audioAlign';
import type { ImportProgress } from './lib/epub';
import { downloadJson, makeId } from './lib/utils';
import { getCachedKnownWords, isSyncEnabled, knownWordsStale, recordEvent, refreshKnownWords, startLearningSync } from './lib/learning';
import { computeKnownWords } from './lib/knownWords';
import { computeStreak, todayActions, wordStateCounts } from './lib/streak';
import { breakLongParagraphs } from './lib/sentence';
import { BUILTIN_BOOK_IDS, builtinShelfEnabled } from './lib/builtinShelf';
import type { AppData, Book, Highlight, LibraryView, Page, ReaderSettings, ReviewLog, SavedSentence, VocabEntry, VoiceRecord, WordGloss, WordState } from './types';
import { addBookToPlaylist, removeBookFromPlaylist } from './lib/playlist';

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
    if (!full) {
      if (!Array.isArray(book.chapters)) return { ...book, chapters: [] };
      // 旧版导入可能把整章存成单段：加载时拆超长块，修复「一本书就一段话」。
      return { ...book, chapters: book.chapters.map((chapter) => ({ ...chapter, paragraphs: breakLongParagraphs(chapter.paragraphs || []) })) };
    }
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
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error'; undo?: () => void } | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [storageChannel, setStorageChannel] = useState<StorageChannel>('indexeddb');
  const saveTimer = useRef<number | null>(null);
  const toastTimer = useRef(0);
  // 跨标签页同步：revRef 记录本标签已知的最新修订号；adoptingRef 标记「这次 data 变更来自外部采纳」，
  // 采纳的快照已由发送方落盘，本标签不再重复写盘/广播（否则会与其它标签互相回放）。
  const revRef = useRef(0);
  const adoptingRef = useRef(false);
  // dataRef 始终指向最新 data，供跨标签页采纳回调读取本地快照（闭包里的 data 会过期）。
  const dataRef = useRef(data);
  dataRef.current = data;
  // 记录各收藏类集合上一轮的长度：一旦有新增就立即落盘（不走防抖），把「刚收藏就被另一标签覆盖」的窗口压到最小。
  const prevSizes = useRef<Record<string, number>>({});
  // 应用内确认弹窗（替代原生 confirm）：askConfirm 返回 Promise，ESC/遮罩/取消都 resolve(false)。
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; confirmLabel?: string; danger?: boolean; resolve: (ok: boolean) => void } | null>(null);
  const activeBook = data.books.find((book) => book.id === activeBookId) || null;
  const savedWords = useMemo(() => data.vocabulary.map((entry) => entry.word), [data.vocabulary]);
  const dueCount = data.vocabulary.filter((entry) => new Date(entry.dueAt).getTime() <= Date.now()).length;

  // P3 难度匹配：已知词 = pathmora 积累（sync 缓存）∪ 本地已 demonstrated 的词。
  const [syncKnown, setSyncKnown] = useState<string[]>(() => getCachedKnownWords());
  const knownWords = useMemo(() => computeKnownWords(data.vocabulary, data.reviewLogs, data.wordStates || {}, syncKnown), [data.vocabulary, data.reviewLogs, data.wordStates, syncKnown]);

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
          revRef.current = stored.rev || 0;
          // 默认空书架：清掉旧版预置的样书/分级/经典（用户自导入的书不受影响）。
          const keptBooks = builtinShelfEnabled() ? stored.books : stored.books.filter((book) => !BUILTIN_BOOK_IDS.has(book.id));
          const migrated: AppData = {
            ...stored,
            books: hydrateBooks(keptBooks),
            vocabulary: stored.vocabulary.map((entry) => ({ ...entry, spokenCount: entry.spokenCount || 0 })),
            voiceRecords: stored.voiceRecords || [],
            sentences: stored.sentences || [],
            wordStates: stored.wordStates || {},
            glosses: { ...gradedGlosses, ...(stored.glosses || {}) },
            libraryViews: stored.libraryViews || [],
            playlists: stored.playlists || [],
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
    // 先比较各收藏类集合长度：有新增（收藏词/句/标记/导入书…）就立即落盘，不走防抖。
    // 这样「刚收藏的词」几乎瞬间写盘并广播给其它标签页，把被旧快照覆盖的窗口压到最小。
    const sizes: Record<string, number> = {
      vocabulary: data.vocabulary.length,
      highlights: data.highlights.length,
      sentences: (data.sentences || []).length,
      books: data.books.length,
      reviewLogs: data.reviewLogs.length,
      voiceRecords: data.voiceRecords.length,
      libraryViews: (data.libraryViews || []).length,
      playlists: (data.playlists || []).length,
    };
    const grew = Object.keys(sizes).some((key) => sizes[key] > (prevSizes.current[key] ?? 0));
    prevSizes.current = sizes;
    // 这次变更来自其它标签页的采纳：快照已由发送方落盘，本标签不再重复写/广播，避免互相回放。
    // 同时取消本标签可能仍在排队的旧写盘定时器，免得它稍后把更旧的快照覆盖回去。
    if (adoptingRef.current) {
      adoptingRef.current = false;
      if (saveTimer.current) { window.clearTimeout(saveTimer.current); saveTimer.current = null; }
      return;
    }
    // 只存瘦身后的书；rev 单调递增，供其它标签页判断新旧。设置/滑杆等高频改动仍防抖批量写。
    const rev = revRef.current + 1;
    revRef.current = rev;
    const snapshot = { ...data, rev, books: slimForStorage(data.books) };
    // 双通道（IndexedDB + localStorage）都写失败时给用户一句话，不再静默吞掉。
    const persist = () => { void saveData(snapshot).then(() => {
      setStorageChannel(getStorageChannel());
    }).catch(() => {
      setStorageChannel(getStorageChannel());
      notify('本地数据保存失败，请检查浏览器存储空间或配额', 'error');
    }); };
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (grew) { saveTimer.current = null; persist(); }
    else saveTimer.current = window.setTimeout(persist, 400);
    const flush = () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); persist(); };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [data, ready]);

  // 跨标签页采纳：其它标签页写盘后，本标签若拿到更新的 rev 就采纳整份快照（而不是用自己旧的覆盖回去）。
  // 这样「一个标签收藏了词，另一个标签改设置」不会再抹掉刚收藏的词。只采纳比本地更新的修订，避免回放过时数据。
  useEffect(() => {
    if (!ready) return;
    const adopt = (incoming: AppData) => {
      const incomingRev = incoming.rev || 0;
      if (incomingRev <= revRef.current) return;
      // 采纳前先把「本地最近几秒刚加、对方快照还没有」的收藏并回去，避免刚收藏的词被整份覆盖抹掉。
      const { data: merged, preserved } = mergeRecentAdds(dataRef.current, incoming);
      const hydrated: AppData = {
        ...merged,
        books: hydrateBooks(merged.books || []),
        vocabulary: (merged.vocabulary || []).map((entry) => ({ ...entry, spokenCount: entry.spokenCount || 0 })),
        voiceRecords: merged.voiceRecords || [],
        sentences: merged.sentences || [],
        wordStates: merged.wordStates || {},
        glosses: { ...gradedGlosses, ...(merged.glosses || {}) },
        libraryViews: merged.libraryViews || [],
        playlists: merged.playlists || [],
      };
      adoptingRef.current = true;
      setData(hydrated);
      if (preserved > 0) {
        // 并回了本地新增：立即把合并结果落盘并广播（rev 抬高一格），确保这些记录真正持久化、对方也能拿到。
        const rev = incomingRev + 1;
        revRef.current = rev;
        const snapshot = { ...hydrated, rev, books: slimForStorage(hydrated.books) };
        void saveData(snapshot).then(() => setStorageChannel(getStorageChannel())).catch(() => {
          setStorageChannel(getStorageChannel());
          notify('本地数据保存失败，请检查浏览器存储空间或配额', 'error');
        });
      } else {
        revRef.current = incomingRev;
      }
    };
    return subscribeExternalSave(adopt, () => { void loadData().then((fresh) => { if (fresh) adopt(fresh); }); });
  }, [ready]);

  // 清掉上一条的定时器：否则前一条的 3200ms 到期会提前清掉后一条 toast。
  const notify = (message: string, tone: 'success' | 'error' = 'success', undo?: () => void) => {
    window.clearTimeout(toastTimer.current);
    setToast({ message, tone, undo });
    // 带撤销的提示停留更久，给用户足够的反悔窗口。
    toastTimer.current = window.setTimeout(() => setToast(null), undo ? 6000 : 3200);
  };

  // 浏览器扩展投递的网页收藏：同源 bridge content script 以 postMessage 送来词/短语/句子，
  // 这里并入数据（走正常 rev 写盘 + 跨标签广播），再回执已采纳的 id 让扩展清队列。
  useEffect(() => {
    if (!ready) return;
    const onMessage = (event: MessageEvent) => {
      const payload = event.data;
      if (!payload || payload.source !== LF_EXT_SOURCE || payload.type !== 'lf-import' || !Array.isArray(payload.items)) return;
      const current = dataRef.current;
      if (!current) return;
      const { data: merged, added } = mergeImportedItems(current, payload.items);
      if (added > 0) {
        setData(merged);
        notify(`已从网页收藏 ${added} 条到词汇本 / 句子`, 'success');
      }
      // 回执所有合法条目 id（含已存在的重复项），让扩展队列彻底清空，避免重复项滞留。
      const ids = payload.items.map((item: { id?: unknown }) => item?.id).filter((id: unknown): id is string => typeof id === 'string');
      const ack: ExtensionImportAck = { source: LF_EXT_SOURCE, type: 'lf-imported', ids };
      window.postMessage(ack, window.location.origin);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [ready]);

  const askConfirm = (options: { title: string; message: string; confirmLabel?: string; danger?: boolean }) => new Promise<boolean>((resolve) => { setConfirmState({ ...options, resolve }); });
  const closeConfirm = (ok: boolean) => { confirmState?.resolve(ok); setConfirmState(null); };
  const updateBook = (id: string, update: Partial<Book>) => setData((current) => ({ ...current, books: current.books.map((book) => book.id === id ? { ...book, ...update } : book) }));
  const updateSettings = (settings: Partial<ReaderSettings>) => setData((current) => ({ ...current, settings: { ...current.settings, ...settings } }));
  // 书库组织：标签 + 保存的视图。
  const setBookTags = (id: string, tags: string[]) => updateBook(id, { tags });
  const saveLibraryView = (view: Omit<LibraryView, 'id'>) => setData((current) => ({ ...current, libraryViews: [...(current.libraryViews || []), { ...view, id: makeId('view') }] }));
  const deleteLibraryView = (id: string) => setData((current) => ({ ...current, libraryViews: (current.libraryViews || []).filter((view) => view.id !== id) }));
  // 课程播放列表：有序 bookId 队列，连续播放带音频的书/课程。
  const createPlaylist = (name: string) => { const id = makeId('playlist'); setData((current) => ({ ...current, playlists: [...(current.playlists || []), { id, name, bookIds: [], createdAt: new Date().toISOString() }] })); return id; };
  const deletePlaylist = (id: string) => setData((current) => ({ ...current, playlists: (current.playlists || []).filter((p) => p.id !== id) }));
  const renamePlaylist = (id: string, name: string) => setData((current) => ({ ...current, playlists: (current.playlists || []).map((p) => p.id === id ? { ...p, name } : p) }));
  const addToPlaylist = (playlistId: string, bookId: string) => setData((current) => ({ ...current, playlists: (current.playlists || []).map((p) => p.id === playlistId ? { ...p, bookIds: addBookToPlaylist(p.bookIds, bookId) } : p) }));
  const removeFromPlaylist = (playlistId: string, bookId: string) => setData((current) => ({ ...current, playlists: (current.playlists || []).map((p) => p.id === playlistId ? { ...p, bookIds: removeBookFromPlaylist(p.bookIds, bookId) } : p) }));
  const reorderPlaylist = (playlistId: string, bookIds: string[]) => setData((current) => ({ ...current, playlists: (current.playlists || []).map((p) => p.id === playlistId ? { ...p, bookIds } : p) }));
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
    if (!ok) return;
    const removed = (data.sentences || []).find((item) => item.id === id);
    setData((current) => ({ ...current, sentences: (current.sentences || []).filter((item) => item.id !== id) }));
    if (removed) notify('已删除收藏句子', 'success', () => setData((current) => ({ ...current, sentences: [removed, ...(current.sentences || []).filter((item) => item.id !== id)] })));
  };
  // 词状态 + 常驻注音释义缓存：标记学习中/已掌握时写入，阅读页据此渲染 ruby 与覆盖率。
  const setWordState = (word: string, state: WordState, gloss?: WordGloss) => setData((current) => ({
    ...current,
    wordStates: { ...(current.wordStates || {}), [word]: state },
    glosses: gloss ? { ...(current.glosses || {}), [word]: gloss } : (current.glosses || {}),
  }));
  const deleteVocab = async (id: string) => {
    const ok = await askConfirm({ title: '删除词条', message: '确定删除这个词条吗？原文和复习记录也会从词汇本移除。', confirmLabel: '删除', danger: true });
    if (!ok) return;
    const removed = data.vocabulary.find((entry) => entry.id === id);
    const removedLogs = data.reviewLogs.filter((log) => log.vocabId === id);
    setData((current) => ({ ...current, vocabulary: current.vocabulary.filter((entry) => entry.id !== id), reviewLogs: current.reviewLogs.filter((log) => log.vocabId !== id) }));
    if (removed) notify('已删除词条', 'success', () => setData((current) => ({ ...current, vocabulary: [removed, ...current.vocabulary.filter((entry) => entry.id !== id)], reviewLogs: [...removedLogs, ...current.reviewLogs] })));
  };
  const deleteVocabMany = async (ids: string[]) => {
    if (!ids.length) return;
    const ok = await askConfirm({ title: '批量删除词条', message: `确定删除选中的 ${ids.length} 个词条吗？它们的复习记录也会一并移除。`, confirmLabel: '删除', danger: true });
    if (!ok) return;
    const idSet = new Set(ids);
    const removed = data.vocabulary.filter((entry) => idSet.has(entry.id));
    const removedLogs = data.reviewLogs.filter((log) => idSet.has(log.vocabId));
    setData((current) => ({ ...current, vocabulary: current.vocabulary.filter((entry) => !idSet.has(entry.id)), reviewLogs: current.reviewLogs.filter((log) => !idSet.has(log.vocabId)) }));
    notify(`已删除 ${removed.length} 个词条`, 'success', () => setData((current) => ({ ...current, vocabulary: [...removed, ...current.vocabulary.filter((entry) => !idSet.has(entry.id))], reviewLogs: [...removedLogs, ...current.reviewLogs] })));
  };
  const deleteBook = async (id: string) => {
    const book = data.books.find((item) => item.id === id);
    // 内置样书来自 STATIC_CONTENT，删了下次 hydrate 又会回来，只允许删自己导入的 EPUB / 文本。
    if (!book || (book.source !== 'epub' && book.source !== 'text' && book.source !== 'pdf')) return;
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
  const deleteHighlight = (id: string) => {
    const removed = data.highlights.find((item) => item.id === id);
    setData((current) => ({ ...current, highlights: current.highlights.filter((item) => item.id !== id) }));
    if (removed) notify('已删除标记', 'success', () => setData((current) => ({ ...current, highlights: [removed, ...current.highlights.filter((item) => item.id !== id)] })));
  };
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
  // 句子回译：把收藏句子的练习结果计入复习记录（streak/每日目标），并强化对应单词的 SRS。
  const reviewSentence = (sentence: SavedSentence, result: ReviewLog['result']) => {
    recordEvent({ type: 'review', word: sentence.word, bookId: sentence.bookId, payload: { result, mode: 'sentence', sentenceId: sentence.id } });
    const increments = { again: 0, hard: 1, good: 2, easy: 3 };
    const days = { again: 0, hard: 1, good: 3, easy: 7 };
    setData((current) => {
      const match = current.vocabulary.find((item) => item.word.toLowerCase() === sentence.word.toLowerCase());
      return {
        ...current,
        vocabulary: match ? current.vocabulary.map((item) => item.id === match.id ? { ...item, familiarity: Math.max(0, Math.min(4, result === 'again' ? 0 : item.familiarity + increments[result])), dueAt: new Date(Date.now() + days[result] * 86400000).toISOString(), reviewCount: item.reviewCount + 1 } : item) : current.vocabulary,
        reviewLogs: [{ id: makeId('review'), vocabId: match ? match.id : `sentence:${sentence.id}`, result, mode: 'sentence', createdAt: new Date().toISOString() }, ...current.reviewLogs],
      };
    });
  };
  // LingQ 式「导入已知词表」：把用户已认识的词直接标为已掌握，喂给难度匹配/覆盖率。
  const importKnownWords = (words: string[]) => {
    if (!words.length) { notify('没有解析到有效的单词（需为 ≥2 个字母的英文词）', 'error'); return; }
    setData((current) => {
      const states = { ...(current.wordStates || {}) };
      for (const word of words) states[word] = 'known';
      return { ...current, wordStates: states };
    });
    notify(`已把 ${words.length} 个词标为「已掌握」，选书难度会据此更新`, 'success');
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
  // 音频一键建课：LessonBuilder 已把音频与句级对齐落盘，这里只把书放进书架并打开。
  const lessonCreated = (book: Book) => {
    setData((current) => ({ ...current, books: [book, ...current.books] }));
    setActiveBookId(book.id);
    notify(`已建课《${book.title}》，边听边看、逐句跟读已就绪`);
  };
  const importBook = async (file: File) => {
    const isText = /\.(txt|md|markdown)$/i.test(file.name) || file.type === 'text/plain' || file.type === 'text/markdown';
    if (isText) { await importText(file.name.replace(/\.(txt|md|markdown)$/i, ''), await file.text()); return; }
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    if (file.size > MAX_EPUB_BYTES) {
      const message = `文件 ${(file.size / 1048576).toFixed(0)}MB 超过 60MB 上限：EPUB / PDF 会整份解包进内存，请先拆分或换体积更小的版本。`;
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
      const book = isPdf
        ? await (await import('./lib/pdfBook')).importPdf(file, setImportProgress)
        : await (await import('./lib/epub')).importEpub(file, setImportProgress);
      setData((current) => ({ ...current, books: [book, ...current.books] }));
      setActiveBookId(book.id);
      notify(`已导入《${book.title}》，共 ${book.chapters.length} 个章节`);
    } catch (error) { notify(error instanceof Error ? error.message : '导入失败，请检查文件。', 'error'); throw error; }
    finally { setImporting(false); setImportProgress(null); }
  };
  const restore = (restored: AppData) => {
    // 恢复备份是「以这份为准」的主动操作：把修订号抬到不低于备份自身，确保随后写盘能盖过其它标签页并被它们采纳。
    revRef.current = Math.max(revRef.current, restored.rev || 0);
    setData({ ...restored, books: hydrateBooks(restored.books), reviewLogs: restored.reviewLogs || [], highlights: restored.highlights || [], voiceRecords: restored.voiceRecords || [], sentences: restored.sentences || [], wordStates: restored.wordStates || {}, glosses: restored.glosses || {}, libraryViews: restored.libraryViews || [], playlists: restored.playlists || [] });
    setActiveBookId(null);
    setPage('library');
    notify('备份已恢复，欢迎回到你的阅读空间');
  };

  if (!ready) return <div className="loading-screen"><img src="/linguaflow-icon.png" alt="LinguaFlow" /><div className="loading-line"><span /></div><p>正在打开你的本地阅读空间…</p></div>;

  let content: React.ReactNode;
  if (activeBook) content = <Reader book={activeBook} settings={data.settings} highlights={data.highlights} savedWords={savedWords} sentences={data.sentences || []} wordStates={data.wordStates || {}} glosses={data.glosses || {}} onBack={() => setActiveBookId(null)} onUpdateBook={updateBook} onSettings={updateSettings} onAddVocab={addVocab} onAddHighlight={addHighlight} onAddSentence={addSentence} onSetWordState={setWordState} onSaveVoice={saveVoiceRecord} onNotify={notify} />;
  else if (page === 'library') content = <Library books={data.books} knownWords={knownWords} onOpen={openBook} onImport={importBook} onImportText={importText} onLessonCreated={lessonCreated} onDelete={deleteBook} importing={importing} importProgress={importProgress} stats={{ ...wordStateCounts(data), streak: computeStreak(data), today: todayActions(data), goal: data.settings.dailyGoal ?? 5 }} onGoal={(goal) => updateSettings({ dailyGoal: goal })} views={data.libraryViews || []} onSaveView={saveLibraryView} onDeleteView={deleteLibraryView} onSetTags={setBookTags} playlists={data.playlists || []} onCreatePlaylist={createPlaylist} onDeletePlaylist={deletePlaylist} onRenamePlaylist={renamePlaylist} onAddToPlaylist={addToPlaylist} onRemoveFromPlaylist={removeFromPlaylist} onReorderPlaylist={reorderPlaylist} />;
  else if (page === 'vocabulary') content = <Vocabulary entries={data.vocabulary} sentences={data.sentences || []} onOpenSource={openSource} onReview={() => setPage('review')} onDelete={deleteVocab} onBulkDelete={deleteVocabMany} onImportKnown={importKnownWords} />;
  else if (page === 'review') content = <Review entries={data.vocabulary} sentences={data.sentences || []} onReview={addReview} onReviewSentence={reviewSentence} onBack={() => setPage('library')} />;
  else if (page === 'voice-lab') content = <VoiceLab books={data.books} highlights={data.highlights} vocabulary={data.vocabulary} voiceRecords={data.voiceRecords} onSave={saveVoiceRecord} onActivateWord={activateSpokenWord} onOpenAnalytics={() => setPage('voice-analytics')} />;
  else if (page === 'voice-analytics') content = <VoiceAnalytics records={data.voiceRecords} vocabulary={data.vocabulary} onPractice={() => setPage('voice-lab')} />;
  else if (page === 'notes') content = <Notes highlights={data.highlights} sentences={data.sentences || []} books={data.books} onOpenSource={openSource} onDelete={deleteHighlight} onDeleteSentence={deleteSentence} />;
  else content = <Settings settings={data.settings} data={data} books={data.books} storageChannel={storageChannel} onSettings={updateSettings} onExport={() => {
    // 恢复上限是 20MB：导出超限时先提醒，避免「自己的备份恢复不回来」。
    const bytes = JSON.stringify(data).length;
    if (bytes > 20 * 1024 * 1024) notify(`备份约 ${(bytes / 1048576).toFixed(0)}MB，超过 20MB 恢复上限，建议先清理大书再导出`, 'error');
    downloadJson(`linguaflow-reader-${new Date().toISOString().slice(0, 10)}.json`, data);
  }} onImport={restore} onNotify={notify} />;

  return <div className={data.settings.reducedAmbient ? 'reduce-ambient' : ''}><AppShell page={page} onNavigate={(target) => { setActiveBookId(null); setPage(target); }} vocabCount={data.vocabulary.length} dueCount={dueCount} online={online}><Suspense fallback={<div className="route-loading"><div className="loading-line"><span /></div><p>正在载入…</p></div>}>{content}</Suspense></AppShell>{confirmState && <ConfirmDialog title={confirmState.title} message={confirmState.message} confirmLabel={confirmState.confirmLabel} danger={confirmState.danger} onConfirm={() => closeConfirm(true)} onCancel={() => closeConfirm(false)} />}{toast && <div className={`toast glass-panel ${toast.tone === 'error' ? 'toast-error' : ''}`} role="status" aria-live="polite">{toast.tone === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}<span>{toast.message}</span>{toast.undo && <button className="toast-undo" onClick={() => { window.clearTimeout(toastTimer.current); toast.undo?.(); setToast(null); }}><Undo2 size={14} />撤销</button>}</div>}</div>;
}
