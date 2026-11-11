import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowRight, AudioLines, BarChart3, CalendarDays, Info, Mic2, Play, TrendingDown, TrendingUp, Type } from 'lucide-react';
import type { VocabEntry, VoiceRecord } from '../types';
import { getVoiceAudio } from '../lib/db';
import { localDay } from '../lib/voice';
import { Button, EmptyState } from './UI';

function average(values: number[]): number {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function GrowthChart({ records }: { records: VoiceRecord[] }) {
  const data = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(); date.setDate(date.getDate() - (29 - index));
    const dayRecords = records.filter((record) => localDay(record.createdAt) === localDay(date));
    return { day: localDay(date), wpm: average(dayRecords.map((record) => record.metrics.wpm)), pause: average(dayRecords.map((record) => record.metrics.pauseRatio)), count: dayRecords.length };
  });
  const points = (key: 'wpm' | 'pause') => data.map((item, index) => ({ x: 42 + index * 20.2, y: key === 'wpm' ? 182 - Math.min(160, item[key] / 200 * 160) : 182 - item[key] / 100 * 160, ...item }));
  const wpm = points('wpm');
  const pause = points('pause');
  const path = (items: { x: number; y: number; count: number }[]) => items.filter((item) => item.count).map((item, index) => `${index ? 'L' : 'M'}${item.x},${item.y}`).join(' ');
  return <div className="growth-chart"><div className="chart-legend"><span><i className="purple" />有效语速 WPM</span><span><i className="cyan" />卡顿率 %</span><small>近 30 天日均</small></div><svg viewBox="0 0 680 225" role="img" aria-label="近30天语速和卡顿率趋势">
    {[22, 62, 102, 142, 182].map((y) => <line key={y} x1="42" x2="638" y1={y} y2={y} stroke="#26263a" strokeWidth="1" />)}
    <text x="8" y="26" fill="#64748b" fontSize="10">200</text><text x="8" y="186" fill="#64748b" fontSize="10">0</text>
    {path(wpm) && <path d={path(wpm)} fill="none" stroke="#8b5cf6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
    {path(pause) && <path d={path(pause)} fill="none" stroke="#22d3ee" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
    {wpm.filter((item) => item.count).map((item) => <circle key={`w-${item.day}`} cx={item.x} cy={item.y} r="4" fill="#8b5cf6"><title>{item.day} · {item.wpm} WPM</title></circle>)}
    {pause.filter((item) => item.count).map((item) => <circle key={`p-${item.day}`} cx={item.x} cy={item.y} r="3.5" fill="#22d3ee"><title>{item.day} · {item.pause}% 卡顿</title></circle>)}
    {[0, 7, 14, 21, 29].map((index) => <text key={index} x={42 + index * 20.2} y="210" textAnchor="middle" fill="#64748b" fontSize="9">{data[index].day.slice(5)}</text>)}
  </svg>{!records.length && <div className="chart-empty">完成练习后，趋势线会从这里开始生长。</div>}</div>;
}

function Heatmap({ records }: { records: VoiceRecord[] }) {
  const days = useMemo(() => {
    const start = new Date(); start.setDate(start.getDate() - 370);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 371 }, (_, index) => {
      const date = new Date(start); date.setDate(date.getDate() + index);
      const dayRecords = records.filter((record) => localDay(record.createdAt) === localDay(date));
      const seconds = dayRecords.reduce((sum, record) => sum + record.metrics.duration, 0);
      const words = dayRecords.reduce((sum, record) => sum + record.metrics.wordCount, 0);
      return { day: localDay(date), seconds, words, future: date > new Date() };
    });
  }, [records]);
  // 月份标签从实际日期范围推算，不再硬编码（跨年 / 不同起始月份时会标错）。
  const monthLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat('en-US', { month: 'short' });
    return [0, 74, 148, 222, 296, 370].map((index) => formatter.format(new Date(`${days[index].day}T00:00:00`)).toUpperCase());
  }, [days]);
  return <div className="heatmap-wrap"><div className="heatmap-months">{monthLabels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div><div className="heatmap-grid">{days.map((day) => <i key={day.day} className={`${day.future ? 'future' : day.seconds === 0 ? '' : day.seconds < 120 ? 'level-1' : day.seconds < 300 ? 'level-2' : day.seconds < 600 ? 'level-3' : 'level-4'}`} title={`${day.day} · ${Math.round(day.seconds / 60)} 分钟 · ${day.words} 词`} />)}</div><div className="heatmap-legend"><span>少</span><i /><i className="level-1" /><i className="level-2" /><i className="level-3" /><i className="level-4" /><span>多</span></div></div>;
}

function TimeCapsule({ records }: { records: VoiceRecord[] }) {
  const groups = useMemo(() => {
    const map = new Map<string, VoiceRecord[]>();
    records.filter((record) => record.targetText).forEach((record) => map.set(record.targetText, [...(map.get(record.targetText) || []), record]));
    return [...map.entries()].filter(([, items]) => items.length > 1);
  }, [records]);
  const [groupIndex, setGroupIndex] = useState(0);
  const group = groups[groupIndex] || groups[0];
  const ordered = group ? [...group[1]].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : [];
  const [aId, setAId] = useState('');
  const [bId, setBId] = useState('');
  const a = ordered.find((record) => record.id === aId) || ordered[0];
  const b = ordered.find((record) => record.id === bId) || ordered[ordered.length - 1];
  const [urls, setUrls] = useState<Record<string, string>>({});
  const urlsRef = useRef<Record<string, string>>({});
  const [missing, setMissing] = useState<Set<string>>(new Set());
  useEffect(() => {
    let active = true;
    const needed = new Set([a?.id, b?.id].filter((id): id is string => Boolean(id)));
    // 释放不再展示的录音 URL，避免长时间停留统计页时 blob URL 累积泄漏
    Object.entries(urlsRef.current).forEach(([id, url]) => {
      if (!needed.has(id)) { URL.revokeObjectURL(url); delete urlsRef.current[id]; }
    });
    const load = (id: string) => {
      if (urlsRef.current[id] || missing.has(id)) return;
      void getVoiceAudio(id).then((blob) => {
        if (!active) return;
        if (!blob) { setMissing((current) => new Set(current).add(id)); return; }
        const url = URL.createObjectURL(blob);
        urlsRef.current[id] = url;
        setUrls((current) => ({ ...current, [id]: url }));
      }).catch(() => {
        // IndexedDB 不可用时 readBlob 会 reject：不 catch 就是未捕获 rejection，
        // 且 urls / missing 都不更新，UI 永远停在「正在读取本地录音…」。
        if (active) setMissing((current) => new Set(current).add(id));
      });
    };
    if (a) load(a.id);
    if (b) load(b.id);
    return () => { active = false; };
  }, [a, b, missing]);
  useEffect(() => () => {
    Object.values(urlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current = {};
  }, []);
  if (!group) return <div className="capsule-empty"><AudioLines size={26} /><h3>同一句，录两次，就会拥有时间胶囊</h3><p>选择同一原句在不同日期练习，这里会开放 A/B 声音与流利度对比。</p></div>;
  return <div className="time-capsule"><div className="capsule-target"><label>对比原句<select value={groupIndex} onChange={(event) => { setGroupIndex(Number(event.target.value)); setAId(''); setBId(''); }}>{groups.map(([text], index) => <option value={index} key={text}>{text.slice(0, 90)}</option>)}</select></label><p>{group[0]}</p></div><div className="ab-grid">{[{ record: a, label: 'BEFORE · 较早录音', set: setAId }, { record: b, label: 'AFTER · 最近录音', set: setBId }].map(({ record, label, set }) => <div className="ab-card" key={label}><span>{label}</span><select value={record.id} onChange={(event) => set(event.target.value)}>{ordered.map((item) => <option value={item.id} key={item.id}>{new Date(item.createdAt).toLocaleDateString('zh-CN')} · {item.metrics.wpm} WPM</option>)}</select><div className="ab-metrics"><strong>{record.metrics.wpm}<small>WPM</small></strong><strong>{record.metrics.pauseRatio}<small>% 卡顿</small></strong><strong>{record.metrics.accuracy}<small>% 匹配</small></strong></div>{urls[record.id] ? <audio src={urls[record.id]} controls preload="metadata" /> : missing.has(record.id) ? <div className="audio-loading muted"><Play size={14} />录音不可读（不在本机，或本地存储不可用）</div> : <div className="audio-loading"><Play size={14} />正在读取本地录音…</div>}</div>)}</div></div>;
}

export default function VoiceAnalytics({ records, vocabulary, onPractice }: { records: VoiceRecord[]; vocabulary: VocabEntry[]; onPractice: () => void }) {
  const totalSeconds = records.reduce((sum, record) => sum + record.metrics.duration, 0);
  const totalWords = records.reduce((sum, record) => sum + record.metrics.wordCount, 0);
  const errorWords = useMemo(() => {
    const counts = new Map<string, number>();
    records.forEach((record) => (record.diffTokens || []).filter((token) => token.status === 'missing' || token.status === 'substitute').forEach((token) => counts.set(token.text, (counts.get(token.text) || 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [records]);
  const activated = vocabulary.filter((entry) => (entry.spokenCount || 0) >= 1).length;
  const internalized = vocabulary.filter((entry) => (entry.spokenCount || 0) >= 3).length;
  const recentWpm = average(records.slice(0, Math.min(5, records.length)).map((record) => record.metrics.wpm));
  const previousWpm = average(records.slice(5, 10).map((record) => record.metrics.wpm));
  return <div className="page voice-analytics-page page-enter"><div className="page-heading"><div><span className="eyebrow">EVERY VOICE LEAVES A TRACE</span><h1>成长，不只是“今天感觉不错”。</h1><p>把语速、停顿、错词和真实开口，变成下一次练习的线索。</p></div><Button onClick={onPractice}><Mic2 size={17} />去录一段</Button></div>
    <div className="analytics-summary"><div className="glass-panel"><span>TOTAL OUTPUT</span><strong>{Math.round(totalSeconds / 60)}<small>分钟</small></strong><p>累计真实开口</p></div><div className="glass-panel"><span>SPOKEN WORDS</span><strong>{totalWords}<small>词</small></strong><p>有效转写词数</p></div><div className="glass-panel"><span>CURRENT WPM</span><strong>{recentWpm}<small>WPM</small></strong><p>{previousWpm ? `较前 5 次 ${recentWpm >= previousWpm ? '+' : ''}${recentWpm - previousWpm}` : '完成更多练习后看趋势'}</p></div><div className="glass-panel"><span>ACTIVATED</span><strong>{activated}<small>词</small></strong><p>从阅读走向口语</p></div></div>
    <section className="analytics-card glass-panel heatmap-card"><div className="analytics-card-head"><div><CalendarDays size={18} /><span><h2>开口热力图</h2><p>过去一年 · 按录音时长着色</p></span></div><strong>{new Set(records.map((record) => localDay(record.createdAt))).size} 天有输出</strong></div><Heatmap records={records} /></section>
    <section className="analytics-card glass-panel"><div className="analytics-card-head"><div><Activity size={18} /><span><h2>流利度成长双曲线</h2><p>关注自己的变化，不与别人的语速比赛</p></span></div>{recentWpm >= previousWpm ? <TrendingUp size={20} /> : <TrendingDown size={20} />}</div><GrowthChart records={records} /></section>
    <div className="analytics-two-col"><section className="analytics-card glass-panel"><div className="analytics-card-head"><div><BarChart3 size={18} /><span><h2>顽固易错词</h2><p>来自真实漏读与替换</p></span></div></div>{errorWords.length ? <div className="error-ranking">{errorWords.map(([word, count], index) => <div key={word}><span>{String(index + 1).padStart(2, '0')}</span><strong>{word}</strong><div><i style={{ width: `${count / errorWords[0][1] * 100}%` }} /></div><small>{count} 次</small></div>)}</div> : <div className="inline-empty">还没有错词记录。完成一次原句跟读后回来看看。</div>}<div className="phoneme-note"><Info size={14} /><span>音素级诊断需要专用发音模型；当前不把字母规则伪装成音素评分。</span></div></section>
      <section className="analytics-card glass-panel"><div className="analytics-card-head"><div><Type size={18} /><span><h2>词汇激活漏斗</h2><p>从“见过”到“真的用出来”</p></span></div></div><div className="activation-funnel"><div style={{ width: '100%' }}><span>阅读收集</span><strong>{vocabulary.length}</strong></div><div style={{ width: `${vocabulary.length ? Math.max(18, activated / vocabulary.length * 100) : 18}%` }}><span>口语用出 ≥1 次</span><strong>{activated}</strong></div><div style={{ width: `${vocabulary.length ? Math.max(12, internalized / vocabulary.length * 100) : 12}%` }}><span>熟练用出 ≥3 次</span><strong>{internalized}</strong></div></div><p className="funnel-caption">{vocabulary.length ? `${Math.round(activated / vocabulary.length * 100)}% 的收藏词已经在口语中被激活` : '收藏词汇后，这里会显示激活转化'}</p></section></div>
    <section className="analytics-card glass-panel"><div className="analytics-card-head"><div><AudioLines size={18} /><span><h2>时间胶囊 A/B</h2><p>同一句话，听见不同日期的自己</p></span></div></div><TimeCapsule records={records} /></section>
    {!records.length && <EmptyState icon={<Mic2 size={25} />} title="数据不是先准备好的，是你说出来的" description="去 Voice Lab 完成第一次 60 秒练习，这里就会开始记录你的成长。" action={<Button onClick={onPractice}>开始第一次录音<ArrowRight size={16} /></Button>} />}
  </div>;
}
