import { useState } from 'react';
import { ArrowRight, BookOpen, Highlighter, MapPin, NotebookPen, Quote, Search, Trash2, Volume2 } from 'lucide-react';
import type { Book, Highlight, SavedSentence } from '../types';
import { formatDate } from '../lib/utils';
import { sentenceParts } from '../lib/sentence';
import { EmptyState } from './UI';

export default function Notes({ highlights, sentences, books, onOpenSource, onDelete, onDeleteSentence }: { highlights: Highlight[]; sentences: SavedSentence[]; books: Book[]; onOpenSource: (item: { bookId: string; chapterId: string; paragraphIndex: number }) => void; onDelete: (id: string) => void; onDeleteSentence: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const needle = query.toLowerCase();
  const filtered = highlights.filter((item) => `${item.text} ${item.note}`.toLowerCase().includes(needle));
  const filteredSentences = sentences.filter((item) => `${item.text} ${item.word} ${item.meaning}`.toLowerCase().includes(needle));
  const speak = (text: string) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  };
  return <div className="page notes-page page-enter">
    <div className="page-heading"><div><span className="eyebrow">THINK WITH THE TEXT</span><h1>标记，是与原文的一次对话。</h1><p>保留触动你的句子，也保留你当时的想法。</p></div></div>
    <div className="list-toolbar"><label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索句子、标记或笔记" /></label><span className="result-count">{sentences.length + highlights.length} 条记录</span></div>

    <div className="notes-section-heading"><Quote size={16} /><h2>收藏的句子</h2><span>{filteredSentences.length}</span></div>
    {!sentences.length ? <EmptyState icon={<Quote size={28} />} title="还没有收藏句子" description="在阅读器里点一个单词，查词面板中点「收藏句子」，整句和释义会存到这里。" /> : <div className="notes-grid sentence-grid">{filteredSentences.map((item) => { const book = books.find((candidate) => candidate.id === item.bookId); return <article className="note-card sentence-card glass-panel" key={item.id}>
      <div className="note-card-top"><span className="mark-symbol sentence"><Quote size={16} /></span><span>{formatDate(item.createdAt)}</span><button className="icon-button" onClick={() => speak(item.text)} aria-label="朗读这句话" title="朗读这句话"><Volume2 size={15} /></button><button className="icon-button" onClick={() => onDeleteSentence(item.id)} aria-label="删除收藏句子"><Trash2 size={15} /></button></div>
      <blockquote>{sentenceParts(item.text, item.word).map((part, index) => part.hit ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</blockquote>
      <div className="sentence-word-row"><strong>{item.word}</strong>{item.phonetic && <span className="phonetic">{item.phonetic}</span>}</div>
      {item.meaning && <p className="sentence-meaning">{item.meaning}</p>}
      <button className="source-link" onClick={() => onOpenSource(item)}><MapPin size={16} /><span><strong>{book?.title || '已移除的书籍'}</strong><small>{item.chapterTitle} · 回到原文位置</small></span><ArrowRight size={16} /></button>
    </article>; })}</div>}

    <div className="notes-section-heading"><Highlighter size={16} /><h2>标记与笔记</h2><span>{filtered.length}</span></div>
    {!highlights.length ? <EmptyState icon={<Highlighter size={28} />} title="还没有标记" description="在阅读器里选中一句话，选择“标记”或“笔记”。" /> : <div className="notes-grid">{filtered.map((item) => { const book = books.find((candidate) => candidate.id === item.bookId); return <article className="note-card glass-panel" key={item.id}><div className="note-card-top"><span className={`mark-symbol ${item.color}`}><Highlighter size={16} /></span><span>{formatDate(item.createdAt)}</span><button className="icon-button" onClick={() => onDelete(item.id)} aria-label="删除标记"><Trash2 size={15} /></button></div><blockquote>{item.text}</blockquote>{item.note && <div className="personal-note"><NotebookPen size={16} /><p>{item.note}</p></div>}<button className="source-link" onClick={() => onOpenSource(item)}><MapPin size={16} /><span><strong>{book?.title || '已移除的书籍'}</strong><small>回到原文位置</small></span><ArrowRight size={16} /></button></article>; })}</div>}

    <div className="notes-tip"><BookOpen size={18} /><div><strong>不要只收藏，也试着回应。</strong><p>一条自己的笔记，往往比十种高亮颜色更有记忆价值。</p></div></div>
  </div>;
}
