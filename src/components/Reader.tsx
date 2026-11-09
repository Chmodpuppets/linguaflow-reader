import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookMarked, BookmarkPlus, Check, ChevronLeft, ChevronRight, Highlighter, Image as ImageIcon, List, Mic2, Minus, NotebookPen, Plus, Settings2, Sparkles, Type, Volume2, X } from 'lucide-react';
import type { Book, Highlight, ReaderSettings, SelectionState, VocabEntry, VoiceRecord } from '../types';
import { lookupWord, normalizeWord } from '../data/dictionary';
import { useBookAudioSrc } from '../lib/bookAudio';
import { Button, Modal, ProgressBar } from './UI';
import AudioBar from './AudioBar';
import VoiceRecorder from './VoiceRecorder';

type NewVocab = Omit<VocabEntry, 'id' | 'createdAt' | 'familiarity' | 'dueAt' | 'reviewCount'>;
type NewHighlight = Omit<Highlight, 'id' | 'createdAt'>;

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
  const ranges = marks.map((mark) => ({ mark, start: text.indexOf(mark.text) })).filter((item) => item.start >= 0).sort((a, b) => a.start - b.start);
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

export default function Reader({ book, settings, highlights, savedWords, onBack, onUpdateBook, onSettings, onAddVocab, onAddHighlight, onSaveVoice, onNotify }: {
  book: Book;
  settings: ReaderSettings;
  highlights: Highlight[];
  savedWords: string[];
  onBack: () => void;
  onUpdateBook: (id: string, update: Partial<Book>) => void;
  onSettings: (settings: Partial<ReaderSettings>) => void;
  onAddVocab: (entry: NewVocab) => void;
  onAddHighlight: (highlight: NewHighlight) => void;
  onSaveVoice: (record: VoiceRecord, audio: Blob) => void;
  onNotify: (message: string) => void;
}) {
  const [chapterIndex, setChapterIndex] = useState(Math.min(book.currentChapter, book.chapters.length - 1));
  const [contentsOpen, setContentsOpen] = useState(() => window.innerWidth >= 1180);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [lookup, setLookup] = useState<{ word: string; context: string; paragraphIndex: number } | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [voiceTarget, setVoiceTarget] = useState('');
  const [viewMode, setViewMode] = useState<'text' | 'image'>('text');
  const [zoom, setZoom] = useState(false);
  const [imageMissing, setImageMissing] = useState(false);
  const articleRef = useRef<HTMLElement>(null);
  // 用户绑定的音频优先于内置静态路径；没有绑定且没有内置音频时返回 undefined → 走 TTS 示范。
  const { src: audioSrc } = useBookAudioSrc(book.id, book.audio);
  const chapter = book.chapters[chapterIndex];
  const canImage = !!book.pageImages && Object.keys(book.pageImages).length > 0;
  // 页码只用于内置扫描书的图片 / OCR 映射。不假设 chapter.id 一定是 `page-N`，
  // 也不把 EPUB 的 `chapter-N` 误当页码 —— 有 pageImages 的书才解析，其余回退章节序号。
  const pageNumber = book.pageImages
    ? Number(chapter.title.match(/\d+/)?.[0] || chapter.id.match(/\d+/)?.[0] || chapterIndex + 1)
    : chapterIndex + 1;
  const pageImage = book.pageImages?.[pageNumber];
  const pageBlocks = book.pageBlocks?.[pageNumber] || [];
  // 版权扫描图不随开源仓库分发；换页 / 换书时重置缺失提示。
  useEffect(() => { setImageMissing(false); }, [book.id, pageNumber]);
  const pageText = chapter.paragraphs.join(' ');
  const dictionary = lookup ? lookupWord(lookup.word) : undefined;
  const isSaved = lookup ? savedWords.includes(normalizeWord(lookup.word)) : false;
  const chapterMarks = useMemo(() => highlights.filter((mark) => mark.bookId === book.id && mark.chapterId === chapter.id), [highlights, book.id, chapter.id]);

  useEffect(() => {
    onUpdateBook(book.id, { currentChapter: chapterIndex, currentParagraph: 0, progress: Math.round((chapterIndex / book.chapters.length) * 100), lastReadAt: new Date().toISOString() });
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
      const rect = range.getBoundingClientRect();
      setSelection({ text, context: chapter.paragraphs[paragraphIndex], bookId: book.id, chapterId: chapter.id, paragraphIndex, x: Math.max(145, Math.min(window.innerWidth - 145, rect.left + rect.width / 2)), y: Math.max(74, rect.top - 10) });
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
    onAddHighlight({ bookId: book.id, chapterId: chapter.id, paragraphIndex: selection.paragraphIndex, text: selection.text, note: withNote ? note : '', color: 'violet' });
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    setNoteOpen(false);
    setNote('');
    onNotify(withNote ? '笔记已保存，并保留原文位置' : '已标记这段原文');
  };

  const saveVocab = (source: { word: string; context: string; paragraphIndex: number }) => {
    const word = normalizeWord(source.word);
    if (savedWords.includes(word)) { onNotify('这个词已经在你的词汇本里'); return; }
    onAddVocab({ word, context: source.context, bookId: book.id, bookTitle: book.title, chapterId: chapter.id, chapterTitle: chapter.title, paragraphIndex: source.paragraphIndex, note: '', dictionary: lookupWord(word) });
    onNotify(`已收藏 ${word}，原句也一起保存了`);
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

  // 键盘翻页（图片模式尤其需要），以及切换视图时收起缩放
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input, textarea')) return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown') goToChapter(chapterIndex + 1);
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') goToChapter(chapterIndex - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chapterIndex, book.chapters.length]);

  useEffect(() => { setZoom(false); setSelection(null); setLookup(null); }, [viewMode, chapterIndex]);

  const switchView = (mode: 'text' | 'image') => { setViewMode(mode); };

  return <div className={`reader-page reader-theme-${settings.theme}`}>
    <div className="reader-toolbar glass-panel"><div className="reader-toolbar-left"><button className="icon-button" onClick={onBack} aria-label="返回书库"><ArrowLeft size={20} /></button><div className="reader-book-title"><strong>{book.title}</strong><span>{chapter.title}</span></div></div><div className="reader-toolbar-center"><span>CHAPTER {String(chapterIndex + 1).padStart(2, '0')}</span><ProgressBar value={Math.round(((chapterIndex + 1) / book.chapters.length) * 100)} /></div><div className="reader-toolbar-actions"><button className={`icon-button ${contentsOpen ? 'active' : ''}`} onClick={() => setContentsOpen(!contentsOpen)} aria-label="目录"><List size={19} /></button>{canImage && <div className="view-toggle" role="group" aria-label="阅读模式"><button className={`icon-button ${viewMode === 'text' ? 'active' : ''}`} onClick={() => switchView('text')} aria-label="文字模式" title="文字模式"><Type size={18} /></button><button className={`icon-button ${viewMode === 'image' ? 'active' : ''}`} onClick={() => switchView('image')} aria-label="图片模式" title="原书图片"><ImageIcon size={18} /></button></div>}<div className="appearance-wrap"><button className={`icon-button ${appearanceOpen ? 'active' : ''}`} onClick={() => setAppearanceOpen(!appearanceOpen)} aria-label="阅读版式"><Settings2 size={19} /></button>{appearanceOpen && <div className="appearance-panel glass-panel"><span className="eyebrow">READING APPEARANCE</span><h3>让正文更适合你</h3><div className="setting-row"><span>字号</span><div className="stepper"><button onClick={() => onSettings({ fontSize: Math.max(16, settings.fontSize - 1) })}><Minus size={15} /></button><strong>{settings.fontSize}</strong><button onClick={() => onSettings({ fontSize: Math.min(26, settings.fontSize + 1) })}><Plus size={15} /></button></div></div><div className="setting-row"><span>行距</span><div className="stepper"><button onClick={() => onSettings({ lineHeight: Math.max(1.5, Number((settings.lineHeight - 0.1).toFixed(1))) })}><Minus size={15} /></button><strong>{settings.lineHeight.toFixed(1)}</strong><button onClick={() => onSettings({ lineHeight: Math.min(2.1, Number((settings.lineHeight + 0.1).toFixed(1))) })}><Plus size={15} /></button></div></div><div className="theme-options">{(['midnight', 'sepia', 'paper'] as const).map((theme) => <button key={theme} className={`${theme} ${settings.theme === theme ? 'active' : ''}`} onClick={() => onSettings({ theme })}><span>Aa</span><small>{theme === 'midnight' ? '暗夜' : theme === 'sepia' ? '羊皮纸' : '白纸'}</small></button>)}</div></div>}</div></div></div>
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
    {audioSrc && <div className="reader-audio"><AudioBar book={book} src={audioSrc} page={pageNumber} onNotify={onNotify} /></div>}
    {selection && <div className="selection-popover glass-panel" style={{ left: selection.x, top: selection.y }} onMouseDown={(event) => event.preventDefault()}><button onClick={() => { setLookup({ word: normalizeWord(selection.text), context: selection.context, paragraphIndex: selection.paragraphIndex }); setSelection(null); }}><BookMarked size={16} /><span>查词</span></button><button onClick={() => saveHighlight(false)}><Highlighter size={16} /><span>标记</span></button><button onClick={() => setNoteOpen(true)}><NotebookPen size={16} /><span>笔记</span></button><button onClick={() => { setVoiceTarget(selection.text); setSelection(null); }}><Mic2 size={16} /><span>跟读对比</span></button><button onClick={() => { saveVocab({ word: selection.text, context: selection.context, paragraphIndex: selection.paragraphIndex }); setSelection(null); }}><BookmarkPlus size={16} /><span>收藏</span></button></div>}
    {lookup && <div className="lookup-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setLookup(null); }}><section className="lookup-panel glass-panel" aria-label="查词面板"><div className="lookup-grabber" /><div className="lookup-head"><div><span className="eyebrow">LOCAL DICTIONARY</span><div className="lookup-word"><h2>{normalizeWord(lookup.word)}</h2><button className="icon-button" onClick={() => speak(normalizeWord(lookup.word))}><Volume2 size={19} /></button></div><span className="phonetic">{dictionary?.phonetic || '本地词库未收录音标'} {dictionary && <i>{dictionary.partOfSpeech}</i>}</span></div><button className="icon-button" onClick={() => setLookup(null)}><X size={20} /></button></div><blockquote>{lookup.context}</blockquote><div className="dictionary-section"><span className="dictionary-number">01</span><div><h3>在这里是什么意思</h3>{dictionary ? <><p className="dictionary-meaning">{dictionary.meaning}</p><p className="dictionary-cn">{dictionary.chinese}</p></> : <p className="dictionary-meaning muted">本地词典暂未收录这个词。你仍可将它和原句一起收藏，之后补充讲解。</p>}</div></div>{dictionary && <div className="dictionary-section"><span className="dictionary-number">02</span><div><h3>可以怎么用</h3><p>{dictionary.usage}</p><div className="example-box"><p>{dictionary.example}</p><span>{dictionary.exampleCn}</span></div><div className="synonyms">{dictionary.synonyms.map((word) => <span key={word}>{word}</span>)}</div></div></div>}<div className="lookup-actions"><Button variant="secondary" onClick={() => setLookup(null)}>返回原文</Button><Button disabled={isSaved} onClick={() => saveVocab(lookup)}>{isSaved ? <Check size={17} /> : <Plus size={17} />}{isSaved ? '已在词汇本' : '连原句一起收藏'}</Button></div></section></div>}
    {noteOpen && selection && <Modal title="给这段原文留条笔记" eyebrow="THINK WITH THE TEXT" onClose={() => setNoteOpen(false)}><blockquote className="note-quote">{selection.text}</blockquote><textarea className="note-input" autoFocus value={note} onChange={(event) => setNote(event.target.value)} placeholder="这句话让你想到了什么？" rows={5} /><div className="modal-actions"><Button variant="ghost" onClick={() => setNoteOpen(false)}>取消</Button><Button onClick={() => saveHighlight(true)} disabled={!note.trim()}>保存笔记</Button></div></Modal>}
    {voiceTarget && <div className="reader-voice-backdrop"><section className="reader-voice-drawer glass-panel"><div className="drawer-heading"><div><span className="eyebrow">LISTEN & CATCH · VOICE LAB</span><h2>跟读对比</h2></div><button className="icon-button" onClick={() => setVoiceTarget('')} aria-label="关闭跟读面板"><X size={20} /></button></div><VoiceRecorder compact targetText={voiceTarget} mode="shadowing" audioUrl={audioSrc} bookId={book.id} onSave={onSaveVoice} /></section></div>}
  </div>;
}
