import { useState } from 'react';
import { ArrowRight, BookOpen, Highlighter, MapPin, NotebookPen, Search, Trash2 } from 'lucide-react';
import type { Book, Highlight } from '../types';
import { formatDate } from '../lib/utils';
import { EmptyState } from './UI';

export default function Notes({ highlights, books, onOpenSource, onDelete }: { highlights: Highlight[]; books: Book[]; onOpenSource: (highlight: Highlight) => void; onDelete: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const filtered = highlights.filter((item) => `${item.text} ${item.note}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="page notes-page page-enter"><div className="page-heading"><div><span className="eyebrow">THINK WITH THE TEXT</span><h1>标记，是与原文的一次对话。</h1><p>保留触动你的句子，也保留你当时的想法。</p></div></div><div className="list-toolbar"><label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标记或笔记" /></label><span className="result-count">{highlights.length} 条记录</span></div>{!highlights.length ? <EmptyState icon={<Highlighter size={28} />} title="还没有标记" description="在阅读器里选中一句话，选择“标记”或“笔记”。" /> : <div className="notes-grid">{filtered.map((item) => { const book = books.find((candidate) => candidate.id === item.bookId); return <article className="note-card glass-panel" key={item.id}><div className="note-card-top"><span className={`mark-symbol ${item.color}`}><Highlighter size={16} /></span><span>{formatDate(item.createdAt)}</span><button className="icon-button" onClick={() => onDelete(item.id)} aria-label="删除标记"><Trash2 size={15} /></button></div><blockquote>{item.text}</blockquote>{item.note && <div className="personal-note"><NotebookPen size={16} /><p>{item.note}</p></div>}<button className="source-link" onClick={() => onOpenSource(item)}><MapPin size={16} /><span><strong>{book?.title || '已移除的书籍'}</strong><small>回到原文位置</small></span><ArrowRight size={16} /></button></article>; })}</div>}<div className="notes-tip"><BookOpen size={18} /><div><strong>不要只收藏，也试着回应。</strong><p>一条自己的笔记，往往比十种高亮颜色更有记忆价值。</p></div></div></div>;
}
