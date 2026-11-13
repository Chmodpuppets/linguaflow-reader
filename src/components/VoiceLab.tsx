import { useMemo, useState } from 'react';
import { ArrowRight, AudioLines, BarChart3, BookOpen, Check, ChevronDown, Clock3, Lightbulb, Mic2, MessageSquareText, Settings2, Sparkles } from 'lucide-react';
import type { Book, Highlight, VocabEntry, VoiceMode, VoiceRecord } from '../types';
import { extractKeywords, localDay } from '../lib/voice';
import { groupShadowings, dueShadowings } from '../lib/spacedShadowing';
import VoiceRecorder from './VoiceRecorder';
import { Button, ConfirmDialog } from './UI';

// 说明：AI 润色（OpenRouter 三栏对比）已按需求暂时下线，入口与调用一并移除。
// 底层实现仍在 src/lib/polish.ts，需要时把面板接回去即可，不必重写。

const modes: { id: VoiceMode; title: string; en: string; description: string; icon: typeof AudioLines }[] = [
  { id: 'shadowing', title: '原句跟读', en: 'Shadowing', description: '先听清，再模仿节奏与表达', icon: AudioLines },
  { id: 'retell', title: '盲听复述', en: 'Cloze Retell', description: '隐藏原文，用关键词脚手架说大意', icon: MessageSquareText },
  { id: 'freetalk', title: '自由独白', en: 'Daily Free Talk', description: '用今天的词汇，说一点真实想法', icon: Mic2 },
];

interface PracticeTarget {
  id: string;
  text: string;
  bookId?: string;
  noteId?: string;
  audioUrl?: string;
  source: string;
}

export default function VoiceLab({ books, highlights, vocabulary, voiceRecords, onSave, onActivateWord, onOpenAnalytics }: {
  books: Book[];
  highlights: Highlight[];
  vocabulary: VocabEntry[];
  voiceRecords: VoiceRecord[];
  onSave: (record: VoiceRecord, audio: Blob) => Promise<boolean>;
  onActivateWord: (word: string) => void;
  onOpenAnalytics: () => void;
}) {
  const [mode, setMode] = useState<VoiceMode>('shadowing');
  const [targetId, setTargetId] = useState('');
  const [customTarget, setCustomTarget] = useState<PracticeTarget | null>(null);
  const [activated, setActivated] = useState<Set<string>>(new Set());
  // 录音进行中切换目标 / 模式会重挂载 VoiceRecorder 并丢弃录音：先弹应用内确认，不再静默丢。
  const [recordingActive, setRecordingActive] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<(() => void) | null>(null);
  const requestSwitch = (action: () => void) => { if (!recordingActive) action(); else setPendingSwitch(() => action); };

  const targets = useMemo<PracticeTarget[]>(() => {
    if (mode === 'freetalk') return [];
    const marked = highlights.map((item) => {
      const book = books.find((candidate) => candidate.id === item.bookId);
      return { id: item.id, text: item.text, bookId: item.bookId, noteId: item.id, audioUrl: book?.audio, source: book?.title || '我的标记' };
    });
    const paragraphs = books.flatMap((book) => book.chapters.flatMap((chapter) => chapter.paragraphs.map((text, index) => ({ id: `${book.id}-${chapter.id}-${index}`, text, bookId: book.id, audioUrl: book.audio, source: `${book.title} · ${chapter.title}` })))).filter((item) => item.text.length > 35 && item.text.length < 650);
    return [...marked, ...paragraphs].slice(0, 200);
  }, [books, highlights, mode]);
  const selected = customTarget || targets.find((target) => target.id === targetId) || targets[0];
  const challenge = useMemo(() => [...vocabulary].sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, 4), [vocabulary]);
  const shadowGroups = useMemo(() => groupShadowings(voiceRecords), [voiceRecords]);
  const dueShadows = useMemo(() => dueShadowings(shadowGroups, Date.now()).slice(0, 4), [shadowGroups]);
  const reRecord = (text: string) => requestSwitch(() => { setMode('shadowing'); setCustomTarget({ id: `spaced-${text.slice(0, 24)}`, text, source: '间隔重录' }); setTargetId(''); setActivated(new Set()); });
  const todayRecords = voiceRecords.filter((record) => localDay(record.createdAt) === localDay(new Date()));
  const todaySeconds = todayRecords.reduce((sum, record) => sum + record.metrics.duration, 0);
  const keywords = selected ? extractKeywords(selected.text) : [];

  const saveRecord = (record: VoiceRecord, audio: Blob) => onSave(record, audio);
  const activate = (word: string) => { setActivated((current) => new Set(current).add(word)); onActivateWord(word); };
  const changeMode = (next: VoiceMode) => { if (next === mode) return; requestSwitch(() => { setMode(next); setTargetId(''); setActivated(new Set()); }); };

  return <div className="page voice-lab-page page-enter">
    <div className="page-heading"><div><span className="eyebrow">NOTICE. OUTPUT. NOTICE AGAIN.</span><h1>把读过的东西，说成自己的。</h1><p>原音是参照，不是答案。录音是起点，反馈才让改变发生。</p></div><Button variant="secondary" onClick={onOpenAnalytics}><BarChart3 size={17} />查看成长统计</Button></div>
    <div className="voice-mode-grid">{modes.map((item) => { const Icon = item.icon; return <button key={item.id} className={`voice-mode-card glass-panel ${mode === item.id ? 'active' : ''}`} onClick={() => changeMode(item.id)}><div className="mode-icon"><Icon size={20} /></div><div><span>{item.en}</span><h3>{item.title}</h3><p>{item.description}</p></div>{mode === item.id && <Check size={17} />}</button>; })}</div>
    <div className="voice-lab-layout">
      <main className="voice-workbench glass-panel">
        <div className="workbench-head"><div><span className="eyebrow">{modes.find((item) => item.id === mode)?.en.toUpperCase()}</span><h2>{mode === 'shadowing' ? '听清差距，再缩小差距' : mode === 'retell' ? '放下原文，保留意义' : '今天，用英语说点真的'}</h2></div><span className="local-pill">LOCAL-FIRST</span></div>
        {mode !== 'freetalk' && <div className="practice-target-select"><label>{mode === 'shadowing' ? '选择收藏句或书中段落' : '选择要复述的段落'}</label><div className="select-wrap"><BookOpen size={16} /><select value={selected?.id || ''} onChange={(event) => { const value = event.target.value; requestSwitch(() => { setCustomTarget(null); setTargetId(value); }); }}>{customTarget && <option value={customTarget.id}>{customTarget.source} — {customTarget.text.slice(0, 55)}{customTarget.text.length > 55 ? '…' : ''}</option>}{targets.map((target) => <option key={target.id} value={target.id}>{target.source} — {target.text.slice(0, 55)}{target.text.length > 55 ? '…' : ''}</option>)}</select><ChevronDown size={15} /></div></div>}
        {mode === 'retell' && selected && <div className="keyword-scaffold"><span>你的表达脚手架</span><div>{keywords.map((word, index) => <strong key={word}><i>0{index + 1}</i>{word}</strong>)}</div><p>60 秒 · 不看原文 · 不求逐字一致，只求意义完整</p></div>}
        {mode === 'freetalk' && <div className="free-talk-prompt"><div><span className="eyebrow">TODAY'S PROMPT</span><h3>What small detail caught your attention today, and why did it stay with you?</h3><p>试着说 60–90 秒。右侧目标词一旦被识别，就会立即点亮。</p></div><div className="activation-grid">{challenge.map((entry) => { const active = activated.has(entry.word); return <div className={active ? 'activated' : ''} key={entry.id}><span>{active ? <Check size={15} /> : <Sparkles size={15} />}</span><strong>{entry.word}</strong><small>{active ? '刚刚说出口' : entry.dictionary?.chinese || '待激活'} · 已用 {entry.spokenCount || 0} 次</small></div>; })}</div></div>}
        <VoiceRecorder key={`${mode}-${selected?.id || 'free'}`} targetText={mode === 'freetalk' ? '' : selected?.text || ''} mode={mode} audioUrl={mode === 'shadowing' ? selected?.audioUrl : undefined} bookId={selected?.bookId} noteId={selected?.noteId} hideTarget={mode === 'retell'} maxDuration={mode === 'retell' ? 60 : 0} challengeWords={mode === 'freetalk' ? challenge.map((entry) => entry.word) : []} onActivateWord={mode === 'freetalk' ? activate : undefined} onSave={saveRecord} onActiveChange={setRecordingActive} />
      </main>
      <aside className="voice-sidebar">
        <section className="voice-today glass-panel"><span className="eyebrow">TODAY'S OUTPUT</span><div className="today-number"><strong>{Math.round(todaySeconds / 60)}</strong><span>分钟<br />真实开口</span></div><div className="today-meta"><span><Mic2 size={14} />{todayRecords.length} 次练习</span><span><Clock3 size={14} />{todayRecords.reduce((sum, record) => sum + record.metrics.wordCount, 0)} 个词</span></div><div className="mini-progress"><span style={{ width: `${Math.min(100, todaySeconds / 3)}%` }} /></div><small>今日轻目标：开口 5 分钟</small></section>
        <section className="practice-principle glass-panel"><Lightbulb size={19} /><h3>别急着“像母语者”</h3><p>先注意一个具体差距：漏掉的词、过长的停顿，或者一句没说完整的话。下一轮只改这一点。</p><div><span>输入</span><ArrowRight size={13} /><span>注意</span><ArrowRight size={13} /><span>输出</span></div></section>
        <section className="spaced-shadow glass-panel"><div className="aside-title"><h3>间隔重录</h3><span className="spaced-tag">1·3·7 天</span></div>{dueShadows.length ? dueShadows.map(({ group, intervalDays }) => <div className="spaced-row" key={group.key}><div className="spaced-text">{group.targetText.slice(0, 48)}{group.targetText.length > 48 ? '…' : ''}</div><div className="spaced-meta"><span>练 {group.count} 次</span><span>{group.firstAccuracy}% → {group.latestAccuracy}%</span><span className={group.deltaWpm >= 0 ? 'up' : 'down'}>{group.deltaWpm >= 0 ? '+' : ''}{group.deltaWpm} WPM</span></div><button className="chip" onClick={() => reRecord(group.targetText)}>隔 {intervalDays} 天 · 重录这句</button></div>) : <div className="spaced-empty"><Clock3 size={18} /><p>跟读过的句子会按 1/3/7 天回到这里。隔天重录，比当场重复更牢。</p></div>}</section>
        <section className="recent-voice glass-panel"><div className="aside-title"><h3>最近练习</h3><button onClick={onOpenAnalytics}>全部<ArrowRight size={13} /></button></div>{voiceRecords.length ? voiceRecords.slice(0, 4).map((record) => <div className="recent-voice-row" key={record.id}><span className={`mode-dot ${record.mode}`} /><div><strong>{record.mode === 'shadowing' ? '原句跟读' : record.mode === 'retell' ? '盲听复述' : '自由独白'}</strong><small>{record.metrics.wpm} WPM · {record.metrics.duration}s</small></div><span>{record.mode === 'freetalk' ? `${record.metrics.wordCount}词` : `${record.metrics.accuracy}%`}</span></div>) : <div className="recent-empty"><Mic2 size={22} /><p>第一次录音后，这里会出现你的练习轨迹。</p></div>}</section>
        <div className="voice-settings-note"><Settings2 size={14} /><span>录音与诊断仅存本机。STT 可用性取决于浏览器。</span></div>
      </aside>
    </div>
    {pendingSwitch && <ConfirmDialog title="切换练习目标" message="正在录音，切换会丢弃本次录音。确定切换吗？" confirmLabel="丢弃并切换" danger onConfirm={() => { pendingSwitch(); setPendingSwitch(null); }} onCancel={() => setPendingSwitch(null)} />}
  </div>;
}
