import { useMemo, useState } from 'react';
import { ArrowRight, BookOpen, Brain, CheckSquare, GalleryHorizontalEnd, List, MapPin, RotateCcw, Search, Square, Trash2, Volume2, X } from 'lucide-react';
import type { VocabEntry } from '../types';
import { formatDate } from '../lib/utils';
import { Button, EmptyState, Modal, Segmented } from './UI';

type SortKey = 'recent' | 'word' | 'familiarity';
type FilterKey = 'all' | 'learning' | 'familiar';

export default function Vocabulary({ entries, onOpenSource, onReview, onDelete, onBulkDelete }: { entries: VocabEntry[]; onOpenSource: (entry: VocabEntry) => void; onReview: () => void; onDelete: (id: string) => void; onBulkDelete: (ids: string[]) => void }) {
  const [view, setView] = useState<'list' | 'gallery'>('list');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<VocabEntry | null>(null);
  const [flipped, setFlipped] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    const list = entries.filter((entry) => `${entry.word} ${entry.context} ${entry.bookTitle}`.toLowerCase().includes(q))
      .filter((entry) => filter === 'all' ? true : filter === 'familiar' ? entry.familiarity >= 3 : entry.familiarity < 3);
    return [...list].sort((a, b) => sort === 'word' ? a.word.localeCompare(b.word) : sort === 'familiarity' ? b.familiarity - a.familiarity : Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }, [entries, query, sort, filter]);

  const mastered = entries.filter((entry) => entry.familiarity >= 3).length;
  const toggleFlip = (id: string) => setFlipped((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleSelect = (id: string) => setSelectedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const exitSelect = () => { setSelectMode(false); setSelectedIds(new Set()); };
  const speak = (word: string) => { const utterance = new SpeechSynthesisUtterance(word); utterance.lang = 'en-US'; window.speechSynthesis?.speak(utterance); };

  return <div className="page vocabulary-page page-enter"><div className="page-heading"><div><span className="eyebrow">WORDS WITH A HOME</span><h1>每一个词，都回到它的语境。</h1><p>不是孤立的词表，是你真正读过、选过、想记住的表达。</p></div><Button onClick={onReview} disabled={!entries.length}><Brain size={17} />开始复习</Button></div>
    <div className="stats-row"><div className="stat-card glass-panel"><span>COLLECTED</span><strong>{entries.length}</strong><small>语境词汇</small></div><div className="stat-card glass-panel"><span>FAMILIAR</span><strong>{mastered}</strong><small>熟悉词汇</small></div><div className="stat-card glass-panel"><span>SOURCES</span><strong>{new Set(entries.map((entry) => entry.bookId)).size}</strong><small>来源书籍</small></div></div>
    <div className="list-toolbar"><label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索单词、原句或书名" /></label>
      <Segmented value={filter} onChange={(v) => setFilter(v as FilterKey)} label="词汇筛选" options={[{ value: 'all', label: '全部' }, { value: 'learning', label: '学习中' }, { value: 'familiar', label: '熟悉' }]} />
      <select className="sort-select" value={sort} onChange={(event) => setSort(event.target.value as SortKey)} aria-label="词汇排序">
        <option value="recent">最近收藏</option><option value="word">按字母</option><option value="familiarity">按熟练度</option>
      </select>
      <Segmented value={view} onChange={setView} label="词汇视图" options={[{ value: 'list', label: 'List', icon: <List size={16} /> }, { value: 'gallery', label: 'Gallery', icon: <GalleryHorizontalEnd size={16} /> }]} />
      <Button variant="ghost" size="sm" onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}>{selectMode ? <><X size={15} />完成</> : <><CheckSquare size={15} />批量</>}</Button>
    </div>
    {selectMode && <div className="bulk-bar glass-panel"><span>已选 {selectedIds.size} 个</span><button className="chip" onClick={() => setSelectedIds(new Set(filtered.map((e) => e.id)))}>全选当前</button><button className="chip" onClick={() => setSelectedIds(new Set())}>清空</button><Button variant="secondary" size="sm" disabled={!selectedIds.size} onClick={() => { onBulkDelete([...selectedIds]); exitSelect(); }}><Trash2 size={15} />删除所选</Button></div>}
    {!entries.length ? <EmptyState icon={<BookOpen size={28} />} title="词汇本还是空的" description="去书库打开一本书，轻点单词，再把它和原句一起收藏。" /> : filtered.length === 0 ? <EmptyState icon={<Search size={28} />} title="没有匹配的词汇" description="换个关键词或筛选条件试试。" /> : view === 'list' ? <div className="vocab-list">{filtered.map((entry) => <article className={`vocab-row glass-panel ${selectMode && selectedIds.has(entry.id) ? 'selected' : ''}`} key={entry.id}>{selectMode && <button className="select-box" aria-label={`选择 ${entry.word}`} onClick={() => toggleSelect(entry.id)}>{selectedIds.has(entry.id) ? <CheckSquare size={18} /> : <Square size={18} />}</button>}<button className="vocab-main" onClick={() => (selectMode ? toggleSelect(entry.id) : setSelected(entry))}><div className="vocab-word"><strong>{entry.word}</strong><span>{entry.dictionary?.phonetic}</span></div><div className="vocab-definition"><p>{entry.dictionary?.chinese || '待补充释义'}</p><span>{entry.dictionary?.meaning || '已保存原文语境'}</span></div><div className="vocab-source"><span>{entry.bookTitle}</span><small>{formatDate(entry.createdAt)}</small></div><ArrowRight size={17} /></button><div className="familiarity-dots" aria-label={`熟练度 ${entry.familiarity}`}>{[1, 2, 3, 4].map((level) => <i className={entry.familiarity >= level ? 'filled' : ''} key={level} />)}</div></article>)}</div> : <div className="vocab-gallery">{filtered.map((entry) => <button className={`flip-card ${flipped.has(entry.id) ? 'flipped' : ''}`} key={entry.id} onClick={() => toggleFlip(entry.id)}><div className="flip-card-inner"><div className="flip-front glass-panel"><span className="eyebrow">RECALL FIRST</span><strong>{entry.word}</strong><p>{entry.dictionary?.phonetic}</p><small><RotateCcw size={13} />点击回忆释义</small></div><div className="flip-back glass-panel"><span className="eyebrow">IN CONTEXT</span><p>“{entry.context}”</p><strong>{entry.dictionary?.chinese || entry.word}</strong><small>{entry.bookTitle}</small></div></div></button>)}</div>}
    {selected && <Modal title={selected.word} eyebrow="VOCABULARY IN CONTEXT" onClose={() => setSelected(null)} wide><div className="word-detail"><div className="word-detail-head"><div><span className="phonetic">{selected.dictionary?.phonetic} {selected.dictionary?.partOfSpeech}</span><h3>{selected.dictionary?.chinese || '等待补充释义'}</h3><p>{selected.dictionary?.meaning}</p></div><button className="icon-button" onClick={() => speak(selected.word)}><Volume2 size={20} /></button></div><blockquote>“{selected.context}”</blockquote><button className="source-link" onClick={() => { onOpenSource(selected); setSelected(null); }}><MapPin size={17} /><span><strong>{selected.bookTitle}</strong><small>{selected.chapterTitle}</small></span><ArrowRight size={17} /></button>{selected.dictionary && <div className="detail-usage"><h4>可以怎么用</h4><p>{selected.dictionary.usage}</p><div className="example-box"><p>{selected.dictionary.example}</p><span>{selected.dictionary.exampleCn}</span></div></div>}<div className="word-meta"><span>收藏于 {formatDate(selected.createdAt)}</span><span>已复习 {selected.reviewCount} 次</span><span>熟练度 {selected.familiarity}/4</span></div><div className="modal-actions space-between"><Button variant="ghost" onClick={() => { onDelete(selected.id); setSelected(null); }}><Trash2 size={16} />删除词条</Button><Button onClick={() => { onOpenSource(selected); setSelected(null); }}>回到原文<ArrowRight size={16} /></Button></div></div></Modal>}
  </div>;
}
