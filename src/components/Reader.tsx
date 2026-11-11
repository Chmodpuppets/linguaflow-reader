import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookMarked, BookmarkPlus, Check, ChevronLeft, ChevronRight, Copy, Headphones, Highlighter, Image as ImageIcon, List, Mic2, Minus, NotebookPen, Plus, Quote, Settings2, Sparkles, Type, Volume2, X } from 'lucide-react';
import type { Book, DictionaryEntry, Highlight, ReaderSettings, SavedSentence, SelectionState, VocabEntry, VoiceRecord } from '../types';
import { lookupWord, normalizeWord } from '../data/dictionary';
import { fetchRemoteDictionary } from '../lib/remoteDictionary';
import { extractSentence, sentenceParts } from '../lib/sentence';
import { useBookAudioSrc } from '../lib/bookAudio';
import { Button, Modal, ProgressBar } from './UI';
import AudioBar from './AudioBar';
import VoiceRecorder from './VoiceRecorder';

// 有声书绑定面板懒加载：它依赖本地 Whisper 对齐（较重），只在用户打开「边听边看」抽屉时才拉取，
// 不拖慢阅读页首屏。
const AudioBindingPanel = lazy(() => import('./AudioBinding'));

type NewVocab = Omit<VocabEntry, 'id' | 'createdAt' | 'familiarity' | 'dueAt' | 'reviewCount'>;
type NewHighlight = Omit<Highlight, 'id' | 'createdAt'>;
type NewSentence = Omit<SavedSentence, 'id' | 'createdAt'>;

function WordText({ text }: { text: string }) {
  return <>{text.split(/(\b[a-zA-Z][a-zA-Z'-]*\b)/g).map((part, index) => /^[a-zA-Z]/.test(part) ? <span className="word" data-word={part} key={`${part}-${index}`}>{part}</span> : part)}</>;
}

type OcrBlock = { x: number; y: number; w: number; h: number; text: string };

// 图片模式的可点选 OCR 文字层：把每个文本块按词等比例铺开，点击单词触发查义，拖动可划选整段。
function OcrLayer({ blocks, onWord, onSelect }: { blocks: OcrBlock[]; onWord: (word: string) => void; onSelect: () => void }) {
  const nodes = useMemo(() => blocks.flatMap((block) => {
    const words = block.text.split(/\s+/).filter(Boolean);
    const total = words.reduce((n, w) => n + w.length, 0) || 1;
    let acc = 0;
    return words.map((word) => {
      const frac = word.length / total;
      const node = {
        word,
        left: (block.x + (acc / total) * block.w) * 100,
        top: (1 - block.y - block.h) * 100,
        width: frac * block.w * 100,
        height: block.h * 100,
      };
      acc += word.length;
      return node;
    });
  }), [blocks]);
  return <div className="ocr-layer" onMouseUp={onSelect} onTouchEnd={onSelect}>{nodes.map((node, index) => <span key={index} className="ocr-word" style={{ left: `${node.left}%`, top: `${node.top}%`, width: `${node.width}%`, height: `${node.height}%` }} onClick={(event) => { event.stopPropagation(); onWord(node.word); }}>{node.word + ' '}</span>)}</div>;
}

function RichParagraph({ text, marks }: { text: string; marks: Highlight[] }) {
  // 优先用划选时记录的偏移：同一段里出现重复文本时，indexOf 永远命中第一处，
  // 会把高亮画在用户没选过的位置。旧数据没有 offset 时回退 indexOf。
  const ranges = marks.map((mark) => ({ mark, start: typeof mark.offset === 'number' && mark.offset >= 0 && text.startsWith(mark.text, mark.offset) ? mark.offset : text.indexOf(mark.text) })).filter((item) => item.start >= 0).sort((a, b) => a.start - b.start);
  if (!ranges.length) return <WordText text={text} />;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(({ mark, start }, index) => {
    if (start < cursor) return;
    if (start > cursor) parts.push(<WordText key={`text-${index}`} text={text.slice(cursor, start)} />);
    parts.push(<mark className={`highlight-${mark.color}`} key={mark.id}>{mark.text}</mark>);
    cursor = start + mark.text.length;
  });
  if (cursor < text.length) parts.push(<WordText key="last" text={text.slice(cursor)} />);
  return <>{parts}</>;
}

export default function Reader({ book, settings, highlights, savedWords, sentences, onBack, onUpdateBook, onSettings, onAddVocab, onAddHighlight, onAddSentence, onSaveVoice, onNotify }: {
  book: Book;
  settings: ReaderSettings;
  highlights: Highlight[];
  savedWords: string[];
  sentences: SavedSentence[];
  onBack: () => void;
  onUpdateBook: (id: string, update: Partial<Book>) => void;
  onSettings: (settings: Partial<ReaderSettings>) => void;
  onAddVocab: (entry: NewVocab) => void;
  onAddHighlight: (highlight: NewHighlight) => void;
  onAddSentence: (sentence: NewSentence) => void;
  onSaveVoice: (record: VoiceRecord, audio: Blob) => Promise<boolean>;
  onNotify: (message: string, tone?: 'success' | 'error') => void;
}) {
  // 钳制到 [0, chapters.length-1]：损坏备份里的负数 / NaN currentChapter 不能算出 -1 索引。
  const [chapterIndex, setChapterIndex] = useState(() => Math.max(0, Math.min(Number(book.currentChapter) || 0, book.chapters.length - 1)));
  const [contentsOpen, setContentsOpen] = useState(() => window.innerWidth >= 1180);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [lookup, setLookup] = useState<{ word: string; context: string; paragraphIndex: number } | null>(null);
  // 在线词典兜底结果（按词缓存于 remoteDictionary）；remote.word 用于防止旧词的释义串到新词上。
  const [remote, setRemote] = useState<{ word: string; entry: DictionaryEntry | null; source: 'server' | 'free' | null } | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false);
  // 查词面板默认只展示含该词的那一句；可切换看整段。换词时重置回句子视图。
  const [showFullParagraph, setShowFullParagraph] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [voiceTarget, setVoiceTarget] = useState('');
  const [viewMode, setViewMode] = useState<'text' | 'image'>('text');
  const [zoom, setZoom] = useState(false);
  const [imageMissing, setImageMissing] = useState(false);
  // 有声书「边听边看」：有音频时控制播放条显隐；没音频时打开绑定抽屉，让用户就地绑定自己的有声书。
  const [audioOpen, setAudioOpen] = useState(true);
  const [audioBindOpen, setAudioBindOpen] = useState(false);
  const articleRef = useRef<HTMLElement>(null);
  // 用户绑定的音频优先于内置静态路径；没有绑定且没有内置音频时返回 undefined → 走 TTS 示范。
  const { src: audioSrc } = useBookAudioSrc(book.id, book.audio);
  // 绑定成功后音频地址就绪：自动收起绑定抽屉、展开播放条，立刻进入边听边看。
  useEffect(() => {
    if (audioSrc && audioBindOpen) { setAudioBindOpen(false); setAudioOpen(true); }
  }, [audioSrc, audioBindOpen]);
  const chapter = book.chapters[chapterIndex];
  const canImage = !!book.pageImages && Object.keys(book.pageImages).length > 0;
  // 页码只用于内置扫描书的图片 / OCR 映射。不假设 chapter.id 一定是 `page-N`，
  // 也不把 EPUB 的 `chapter-N` 误当页码 —— 有 pageImages 的书才解析，其余回退章节序号。
  const pageNumber = book.pageImages
    ? Number(chapter?.title.match(/\d+/)?.[0] || chapter?.id.match(/\d+/)?.[0] || chapterIndex + 1)
    : chapterIndex + 1;
  const pageImage = book.pageImages?.[pageNumber];
  const pageBlocks = book.pageBlocks?.[pageNumber] || [];
  // 版权扫描图不随开源仓库分发；换页 / 换书时重置缺失提示。
  useEffect(() => { setImageMissing(false); }, [book.id, pageNumber]);
  const pageText = chapter?.paragraphs.join(' ') || '';
  const localDict = lookup ? lookupWord(lookup.word) : undefined;
  // 本地词库优先（带中文讲解）；本地未收录时用在线词典兜底，让任意英文词都有真实释义。
  const dictionary = localDict || (lookup && remote?.word === lookup.word ? remote.entry || undefined : undefined);
  const isSaved = lookup ? savedWords.includes(normalizeWord(lookup.word)) : false;
  // 句子级上下文：只取含该词的那一句（整段会把释义挤出首屏，也不利于收藏）。
  const lookupSentence = lookup ? extractSentence(lookup.context, lookup.word) : '';
  const sentenceSaved = lookup ? sentences.some((item) => item.bookId === book.id && item.text === lookupSentence) : false;

  // 打开查词面板且本地未收录时，异步拉在线词典；切换词 / 关闭面板即作废上一次请求。
  useEffect(() => {
    setShowFullParagraph(false);
    if (!lookup) { setRemote(null); setRemoteLoading(false); return; }
    const word = lookup.word;
    if (lookupWord(word)) { setRemote(null); setRemoteLoading(false); return; }
    let active = true;
    setRemoteLoading(true);
    void fetchRemoteDictionary(word).then((result) => {
      if (!active) return;
      setRemote({ word, entry: result?.entry ?? null, source: result?.source ?? null });
      setRemoteLoading(false);
    });
    return () => { active = false; };
  }, [lookup]);
  const chapterMarks = useMemo(() => highlights.filter((mark) => mark.bookId === book.id && mark.chapterId === chapter?.id), [highlights, book.id, chapter?.id]);

  useEffect(() => {
    onUpdateBook(book.id, { currentChapter: chapterIndex, currentParagraph: 0, progress: book.chapters.length ? Math.round((chapterIndex / book.chapters.length) * 100) : 0, lastReadAt: new Date().toISOString() });
    setLookup(null);
    setSelection(null);
    const target = book.currentParagraph;
    if (chapterIndex === book.currentChapter && target > 0) setTimeout(() => document.getElementById(`paragraph-${target}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    else articleRef.current?.closest('.main-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [chapterIndex]);

  const captureSelection = (paragraphIndex: number) => {
    setTimeout(() => {
      const current = window.getSelection();
      const text = current?.toString().trim() || '';
      if (!current || !text || current.rangeCount === 0) return;
      const range = current.getRangeAt(0);
      const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement;
      const endElement = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer as Element : range.endContainer.parentElement;
      const startParagraph = startElement?.closest('[data-paragraph]');
      const endParagraph = endElement?.closest('[data-paragraph]');
      if (!startParagraph || startParagraph !== endParagraph) return;
      // 记录划选起点在段落内的字符偏移：渲染文本与原文逐字一致，
      // 用 pre-caret range 的文本长度即可定位重复文本中的实际划选处。
      const pre = range.cloneRange();
      pre.selectNodeContents(startParagraph);
      pre.setEnd(range.startContainer, range.startOffset);
      const offset = pre.toString().length;
      const rect = range.getBoundingClientRect();
      setSelection({ text, context: chapter.paragraphs[paragraphIndex], bookId: book.id, chapterId: chapter.id, paragraphIndex, offset, x: Math.max(145, Math.min(window.innerWidth - 145, rect.left + rect.width / 2)), y: Math.max(74, rect.top - 10) });
    }, 10);
  };

  const handleParagraphClick = (event: React.MouseEvent<HTMLParagraphElement>, paragraphIndex: number) => {
    if ((window.getSelection()?.toString() || '').trim()) return;
    const target = event.target as HTMLElement;
    const word = target.dataset.word;
    if (word) {
      setLookup({ word: normalizeWord(word), context: chapter.paragraphs[paragraphIndex], paragraphIndex });
      setSelection(null);
      onUpdateBook(book.id, { currentParagraph: paragraphIndex });
    }
  };

  const handleImageWord = (word: string) => {
    if ((window.getSelection()?.toString() || '').trim()) return;
    setLookup({ word: normalizeWord(word), context: pageText, paragraphIndex: 0 });
    setSelection(null);
  };

  const captureImageSelection = () => {
    setTimeout(() => {
      const current = window.getSelection();
      const text = current?.toString().trim() || '';
      if (!current || !text || current.rangeCount === 0) return;
      const range = current.getRangeAt(0);
      const node = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement;
      if (!node?.closest('.ocr-layer')) return;
      const rect = range.getBoundingClientRect();
      setSelection({ text, context: pageText, bookId: book.id, chapterId: chapter.id, paragraphIndex: 0, x: Math.max(145, Math.min(window.innerWidth - 145, rect.left + rect.width / 2)), y: Math.max(74, rect.top - 10) });
    }, 10);
  };

  const saveHighlight = (withNote = false) => {
    if (!selection) return;
    onAddHighlight({ bookId: book.id, chapterId: chapter.id, paragraphIndex: selection.paragraphIndex, text: selection.text, offset: selection.offset, note: withNote ? note : '', color: 'violet' });
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    setNoteOpen(false);
    setNote('');
    onNotify(withNote ? '笔记已保存，并保留原文位置' : '已标记这段原文');
  };

  const saveVocab = (source: { word: string; context: string; paragraphIndex: number }) => {
    const word = normalizeWord(source.word);
    if (savedWords.includes(word)) { onNotify('这个词已经在你的词汇本里'); return; }
    // 词汇本里的「原句」也存句子级上下文，而不是整段，回顾时更聚焦。
    onAddVocab({ word, context: extractSentence(source.context, word), bookId: book.id, bookTitle: book.title, chapterId: chapter.id, chapterTitle: chapter.title, paragraphIndex: source.paragraphIndex, note: '', dictionary: lookupWord(word) || (remote?.word === word ? remote.entry || undefined : undefined) });
    onNotify(`已收藏 ${word}，原句也一起保存了`);
  };

  // 收藏句子：把含该词的整句 + 当时释义存进句子收藏（笔记页可回顾 / 朗读 / 回原文）。
  const saveSentence = () => {
    if (!lookup) return;
    if (sentenceSaved) { onNotify('这句话已经在你的句子收藏里'); return; }
    onAddSentence({ text: lookupSentence, word: normalizeWord(lookup.word), meaning: dictionary?.meaning || '', phonetic: dictionary?.phonetic || '', bookId: book.id, bookTitle: book.title, chapterId: chapter.id, chapterTitle: chapter.title, paragraphIndex: lookup.paragraphIndex });
    onNotify('已收藏这句话，可在「笔记」页回顾');
  };

  const speakSentence = () => {
    if (!('speechSynthesis' in window) || !lookupSentence) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(lookupSentence);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  };

  const copySentence = () => {
    if (!lookupSentence) return;
    void navigator.clipboard?.writeText(lookupSentence).then(() => onNotify('句子已复制到剪贴板')).catch(() => onNotify('复制失败，请手动选择文本', 'error'));
  };

  const speak = (word: string) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'en-US';
    utterance.rate = 0.85;
    window.speechSynthesis.speak(utterance);
  };

  const goToChapter = (index: number) => {
    if (index < 0 || index >= book.chapters.length) return;
    setChapterIndex(index);
    if (window.innerWidth < 1100) setContentsOpen(false);
  };

  // 键盘翻页（图片模式尤其需要），以及切换视图时收起缩放。
  // 查词面板 / 笔记 Modal / 跟读抽屉 / 版式面板打开时不响应，避免在遮罩后偷偷翻页。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input, textarea')) return;
      if (lookup || noteOpen || voiceTarget || appearanceOpen || selection) return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown') goToChapter(chapterIndex + 1);
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') goToChapter(chapterIndex - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chapterIndex, book.chapters.length, lookup, noteOpen, voiceTarget, appearanceOpen, selection]);

  // ESC 逐层关闭自定义面板（跟读抽屉 > 查词 > 划选 > 版式）。
  // 笔记 Modal 自带 ESC（capture + stopPropagation），这里 noteOpen 时让位给它。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || noteOpen) return;
      if (voiceTarget) { setVoiceTarget(''); return; }
      if (lookup) { setLookup(null); return; }
      if (selection) { setSelection(null); return; }
      if (appearanceOpen) setAppearanceOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [voiceTarget, lookup, selection, appearanceOpen, noteOpen]);

  useEffect(() => { setZoom(false); setSelection(null); setLookup(null); }, [viewMode, chapterIndex]);

  const switchView = (mode: 'text' | 'image') => { setViewMode(mode); };

  // 空章节的书（损坏数据 / 解析异常）给降级提示而不是让 chapter.paragraphs 抛错白屏。
  if (!chapter) return <div className={`reader-page reader-theme-${settings.theme}`}><div className="reader-toolbar glass-panel"><div className="reader-toolbar-left"><button className="icon-button" onClick={onBack} aria-label="返回书库"><ArrowLeft size={20} /></button><div className="reader-book-title"><strong>{book.title}</strong><span>无法阅读</span></div></div></div><div className="reader-layout"><article className="reader-article"><div className="empty-page-note"><p>这本书没有可阅读的章节，可能是备份数据损坏或导入不完整。请返回书库删除后重新导入。</p><Button variant="secondary" onClick={onBack}><ArrowLeft size={16} />返回书库</Button></div></article></div></div>;

  return <div className={`reader-page reader-theme-${settings.theme}`}>
    <div className="reader-toolbar glass-panel"><div className="reader-toolbar-left"><button className="icon-button" onClick={onBack} aria-label="返回书库"><ArrowLeft size={20} /></button><div className="reader-book-title"><strong>{book.title}</strong><span>{chapter.title}</span></div></div><div className="reader-toolbar-center"><span>CHAPTER {String(chapterIndex + 1).padStart(2, '0')}</span><ProgressBar value={Math.round(((chapterIndex + 1) / book.chapters.length) * 100)} /></div><div className="reader-toolbar-actions"><button className={`icon-button ${contentsOpen ? 'active' : ''}`} onClick={() => setContentsOpen(!contentsOpen)} aria-label="目录"><List size={19} /></button>{canImage && <div className="view-toggle" role="group" aria-label="阅读模式"><button className={`icon-button ${viewMode === 'text' ? 'active' : ''}`} onClick={() => switchView('text')} aria-label="文字模式" title="文字模式"><Type size={18} /></button><button className={`icon-button ${viewMode === 'image' ? 'active' : ''}`} onClick={() => switchView('image')} aria-label="图片模式" title="原书图片"><ImageIcon size={18} /></button></div>}<button className={`icon-button ${(audioSrc && audioOpen) || audioBindOpen ? 'active' : ''}`} onClick={() => { if (audioSrc) setAudioOpen(!audioOpen); else setAudioBindOpen(true); }} aria-label="有声书边听边看" title={audioSrc ? (audioOpen ? '隐藏有声书播放条' : '显示有声书播放条') : '绑定有声书，边听边看'}><Headphones size={19} /></button><div className="appearance-wrap"><button className={`icon-button ${appearanceOpen ? 'active' : ''}`} onClick={() => setAppearanceOpen(!appearanceOpen)} aria-label="阅读版式"><Settings2 size={19} /></button>{appearanceOpen && <div className="appearance-panel glass-panel"><span className="eyebrow">READING APPEARANCE</span><h3>让正文更适合你</h3><div className="setting-row"><span>字号</span><div className="stepper"><button onClick={() => onSettings({ fontSize: Math.max(16, settings.fontSize - 1) })}><Minus size={15} /></button><strong>{settings.fontSize}</strong><button onClick={() => onSettings({ fontSize: Math.min(26, settings.fontSize + 1) })}><Plus size={15} /></button></div></div><div className="setting-row"><span>行距</span><div className="stepper"><button onClick={() => onSettings({ lineHeight: Math.max(1.5, Number((settings.lineHeight - 0.1).toFixed(1))) })}><Minus size={15} /></button><strong>{settings.lineHeight.toFixed(1)}</strong><button onClick={() => onSettings({ lineHeight: Math.min(2.1, Number((settings.lineHeight + 0.1).toFixed(1))) })}><Plus size={15} /></button></div></div><div className="theme-options">{(['midnight', 'sepia', 'paper'] as const).map((theme) => <button key={theme} className={`${theme} ${settings.theme === theme ? 'active' : ''}`} onClick={() => onSettings({ theme })}><span>Aa</span><small>{theme === 'midnight' ? '暗夜' : theme === 'sepia' ? '羊皮纸' : '白纸'}</small></button>)}</div></div>}</div></div></div>
    <div className="reader-layout">
      <article className={`reader-article ${viewMode === 'image' && pageImage ? 'reader-article-image' : ''}`} ref={articleRef} style={{ '--reader-size': `${settings.fontSize}px`, '--reader-leading': settings.lineHeight } as React.CSSProperties}>
        <header className="chapter-header"><span className="eyebrow">PAGE {String(pageNumber).padStart(2, '0')}</span><h1>{chapter.title}</h1><p>{book.title} · {book.author}</p><div className="chapter-rule"><span /></div></header>
        {viewMode === 'image' && pageImage ? (
          <div className={`page-image ${zoom ? 'zoom' : ''}`} onClick={() => setZoom(!zoom)} title="点击切换缩放">
            <div className="page-image-stage">
              {imageMissing
                ? <div className="page-image-missing"><ImageIcon size={26} /><strong>本机没有这张扫描图</strong><p>页面扫描图属于第三方版权内容，不随开源仓库分发。把合法获得的图片放回 <code>public/books/&lt;book&gt;/</code>，或切回文字模式。</p></div>
                : <img src={pageImage} alt={`第 ${pageNumber} 页扫描原图`} loading="lazy" decoding="async" onError={() => setImageMissing(true)} />}
              {!imageMissing && pageBlocks.length > 0 && <OcrLayer blocks={pageBlocks} onWord={handleImageWord} onSelect={captureImageSelection} />}
            </div>
            <span className="page-image-hint">{zoom ? '点击恢复 · 点词可查义' : '点击放大 · 点图上单词查义'}</span>
          </div>
        ) : (
          <>
            <div className="reading-tip"><Sparkles size={15} /><span>轻点单词查义，选中句子做标记。让 AI 退后一步，让注意力留在原文。</span></div>
            <div className="chapter-body">{chapter.paragraphs.length ? chapter.paragraphs.map((paragraph, index) => <p id={`paragraph-${index}`} data-paragraph={index} key={`${chapter.id}-${index}`} onMouseUp={() => captureSelection(index)} onTouchEnd={() => captureSelection(index)} onClick={(event) => handleParagraphClick(event, index)}><RichParagraph text={paragraph} marks={chapterMarks.filter((mark) => mark.paragraphIndex === index)} /></p>) : <p className="empty-page-note">这一页是插画，没有文字。切到「图片」看原版。</p>}</div>
          </>
        )}
        <div className="chapter-end"><span>{chapter.paragraphs.length ? 'END OF PAGE' : 'END OF PAGE'}</span><div><Button variant="secondary" disabled={chapterIndex === 0} onClick={() => goToChapter(chapterIndex - 1)}><ChevronLeft size={17} />上一页</Button><Button disabled={chapterIndex === book.chapters.length - 1} onClick={() => goToChapter(chapterIndex + 1)}>下一页<ChevronRight size={17} /></Button></div></div>
      </article>
      <aside className={`reader-aside glass-panel ${contentsOpen ? 'open' : ''}`}><div className="aside-heading"><div><span className="eyebrow">IN THIS BOOK</span><h3>目录</h3></div><button className="icon-button" onClick={() => setContentsOpen(false)}><X size={17} /></button></div><div className="toc-list">{book.chapters.map((item, index) => <button className={index === chapterIndex ? 'active' : ''} key={item.id} onClick={() => goToChapter(index)}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.title}</strong>{index === chapterIndex && <ArrowRight size={15} />}</button>)}</div><div className="aside-note"><BookMarked size={18} /><strong>阅读数据在本机</strong><p>当前书籍、标记与词汇均可离线访问。</p></div></aside>
    </div>
    {audioSrc && audioOpen && <div className="reader-audio"><AudioBar book={book} src={audioSrc} page={pageNumber} onNotify={onNotify} /></div>}
    {selection && <div className="selection-popover glass-panel" style={{ left: selection.x, top: selection.y }} onMouseDown={(event) => event.preventDefault()}><button onClick={() => { setLookup({ word: normalizeWord(selection.text), context: selection.context, paragraphIndex: selection.paragraphIndex }); setSelection(null); }}><BookMarked size={16} /><span>查词</span></button><button onClick={() => saveHighlight(false)}><Highlighter size={16} /><span>标记</span></button><button onClick={() => setNoteOpen(true)}><NotebookPen size={16} /><span>笔记</span></button><button onClick={() => { setVoiceTarget(selection.text); setSelection(null); }}><Mic2 size={16} /><span>跟读对比</span></button><button onClick={() => { saveVocab({ word: selection.text, context: selection.context, paragraphIndex: selection.paragraphIndex }); setSelection(null); }}><BookmarkPlus size={16} /><span>收藏</span></button></div>}
    {lookup && <div className="lookup-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setLookup(null); }}>
      <section className="lookup-panel glass-panel" aria-label="查词面板">
        <div className="lookup-grabber" />
        <div className="lookup-head"><div><span className="eyebrow">{localDict ? 'LOCAL DICTIONARY' : dictionary ? (remote?.source === 'server' ? 'SERVER DICTIONARY · 英汉' : 'ONLINE DICTIONARY') : 'DICTIONARY'}</span><div className="lookup-word"><h2>{normalizeWord(lookup.word)}</h2><button className="icon-button" onClick={() => speak(normalizeWord(lookup.word))} aria-label="朗读单词"><Volume2 size={19} /></button></div><span className="phonetic">{dictionary?.phonetic || (remoteLoading ? '正在查询服务器词典…' : '暂无音标')} {dictionary && dictionary.partOfSpeech && <i>{dictionary.partOfSpeech}</i>}</span></div><button className="icon-button" onClick={() => setLookup(null)} aria-label="关闭查词面板"><X size={20} /></button></div>
        <div className="dictionary-section lookup-definition"><span className="dictionary-number">01</span><div><h3>释义</h3>{dictionary ? <><p className="dictionary-meaning">{dictionary.meaning}</p>{dictionary.chinese && <p className="dictionary-cn">{dictionary.chinese}</p>}</> : remoteLoading ? <p className="dictionary-meaning muted">本地词库未收录，正在查询服务器词典…</p> : <p className="dictionary-meaning muted">本地与在线词典都暂未收录这个词（离线时仅用本地词库）。你仍可将它和原句一起收藏，之后补充讲解。</p>}</div></div>
        <div className="dictionary-section"><span className="dictionary-number">02</span><div>
          <div className="sentence-head"><h3>原句</h3><button className="text-toggle" onClick={() => setShowFullParagraph(!showFullParagraph)}>{showFullParagraph ? '只看句子' : '查看整段'}</button></div>
          <blockquote className="lookup-sentence">{showFullParagraph ? lookup.context : sentenceParts(lookupSentence, lookup.word).map((part, index) => part.hit ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</blockquote>
          <div className="sentence-meta"><Quote size={13} /><span>{book.title} · {chapter.title}</span></div>
          <div className="sentence-actions">
            <Button variant={sentenceSaved ? 'secondary' : 'primary'} onClick={saveSentence} disabled={sentenceSaved}>{sentenceSaved ? <Check size={16} /> : <BookmarkPlus size={16} />}{sentenceSaved ? '已收藏句子' : '收藏句子'}</Button>
            <button className="icon-button" onClick={speakSentence} aria-label="朗读这句话" title="朗读这句话"><Volume2 size={17} /></button>
            <button className="icon-button" onClick={copySentence} aria-label="复制这句话" title="复制这句话"><Copy size={17} /></button>
          </div>
        </div></div>
        {dictionary && (dictionary.usage || dictionary.example || dictionary.synonyms.length > 0) && <div className="dictionary-section"><span className="dictionary-number">03</span><div><h3>可以怎么用</h3>{dictionary.usage && <p>{dictionary.usage}</p>}{dictionary.example && <div className="example-box"><p>{dictionary.example}</p>{dictionary.exampleCn && <span>{dictionary.exampleCn}</span>}</div>}{dictionary.synonyms.length > 0 && <div className="synonyms">{dictionary.synonyms.map((word) => <span key={word}>{word}</span>)}</div>}</div></div>}
        <div className="lookup-actions"><Button variant="secondary" onClick={() => setLookup(null)}>返回原文</Button><Button disabled={isSaved} onClick={() => saveVocab(lookup)}>{isSaved ? <Check size={17} /> : <Plus size={17} />}{isSaved ? '已在词汇本' : '收藏单词'}</Button></div>
      </section>
    </div>}
    {noteOpen && selection && <Modal title="给这段原文留条笔记" eyebrow="THINK WITH THE TEXT" onClose={() => setNoteOpen(false)}><blockquote className="note-quote">{selection.text}</blockquote><textarea className="note-input" autoFocus value={note} onChange={(event) => setNote(event.target.value)} placeholder="这句话让你想到了什么？" rows={5} /><div className="modal-actions"><Button variant="ghost" onClick={() => setNoteOpen(false)}>取消</Button><Button onClick={() => saveHighlight(true)} disabled={!note.trim()}>保存笔记</Button></div></Modal>}
    {voiceTarget && <div className="reader-voice-backdrop"><section className="reader-voice-drawer glass-panel"><div className="drawer-heading"><div><span className="eyebrow">LISTEN & CATCH · VOICE LAB</span><h2>跟读对比</h2></div><button className="icon-button" onClick={() => setVoiceTarget('')} aria-label="关闭跟读面板"><X size={20} /></button></div><VoiceRecorder compact targetText={voiceTarget} mode="shadowing" audioUrl={audioSrc} bookId={book.id} onSave={onSaveVoice} /></section></div>}
    {audioBindOpen && <div className="reader-voice-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAudioBindOpen(false); }}>
      <section className="reader-voice-drawer glass-panel" aria-label="有声书边听边看">
        <div className="drawer-heading"><div><span className="eyebrow">AUDIOBOOK · LISTEN WHILE READING</span><h2>有声书 · 边听边看</h2></div><button className="icon-button" onClick={() => setAudioBindOpen(false)} aria-label="关闭有声书面板"><X size={20} /></button></div>
        <p className="audio-bind-hint">这本书还没有音频。绑定你自己的有声书文件后，阅读页底部会出现播放条：播放 / 变速 / ±15s，还能「锚定本页 + 联动」实现翻到哪页听到哪页。绑定后可在本机生成句级定位。音频只存本机 IndexedDB，不上传、不进备份。</p>
        <Suspense fallback={<div className="route-loading"><div className="loading-line"><span /></div><p>正在载入…</p></div>}>
          <AudioBindingPanel books={[book]} onNotify={onNotify} />
        </Suspense>
      </section>
    </div>}
  </div>;
}
