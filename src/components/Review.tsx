import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Brain, Check, CheckCircle2, RotateCcw, Sparkles, X } from 'lucide-react';
import type { ReviewLog, VocabEntry } from '../types';
import { Button, EmptyState, ProgressBar, Segmented } from './UI';
import { fetchFallbackPlan, fetchReaderPlan, getSyncToken, isSyncEnabled, type ReaderPlan } from '../lib/learning';

type Mode = 'flashcard' | 'cloze';
type Result = ReviewLog['result'];

export default function Review({ entries, onReview, onBack }: { entries: VocabEntry[]; onReview: (entry: VocabEntry, result: Result, mode: Mode) => void; onBack: () => void }) {
  const [mode, setMode] = useState<Mode>('flashcard');
  const [queue, setQueue] = useState<VocabEntry[]>([]);
  const [index, setIndex] = useState(0);
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [answer, setAnswer] = useState('');
  const [checked, setChecked] = useState(false);
  const [score, setScore] = useState(0);
  const [plan, setPlan] = useState<ReaderPlan | null>(null);
  const current = queue[index];
  const due = useMemo(() => entries.filter((entry) => new Date(entry.dueAt).getTime() <= Date.now()).length, [entries]);
  const cloze = current ? current.context.replace(new RegExp(current.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '_____') : '';
  const correct = current ? answer.trim().toLowerCase().replace(/[^a-z'-]/g, '') === current.word.toLowerCase() : false;
  // 连接账号后优先拉取 pathmora 下发的今日计划；不可达时用已部署的 linguaflow 学习记录做本地降级计划；
  // 两者都不可达才回退纯本地 SRS（阅读/复习不被阻塞）。
  useEffect(() => {
    if (!isSyncEnabled() || !getSyncToken()) return;
    let alive = true;
    void (async () => {
      const p = (await fetchReaderPlan()) ?? (await fetchFallbackPlan());
      if (alive) setPlan(p);
    })();
    return () => { alive = false; };
  }, []);
  const start = () => {
    const local = [...entries].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    let ordered = local;
    if (plan && plan.due.length) {
      const byWord = new Map(local.map((e) => [e.word.toLowerCase(), e]));
      const fromPlan = plan.due.map((t) => byWord.get(t.word.toLowerCase())).filter((e): e is VocabEntry => !!e);
      if (fromPlan.length) ordered = fromPlan;
    }
    setQueue(ordered.slice(0, 20)); setIndex(0); setScore(0); setStarted(true); setFinished(false); setRevealed(false);
  };
  const next = (earned: boolean) => { if (earned) setScore((value) => value + 1); if (index + 1 >= queue.length) setFinished(true); else { setIndex(index + 1); setRevealed(false); setAnswer(''); setChecked(false); } };
  const rate = (result: Result) => { if (!current) return; onReview(current, result, 'flashcard'); next(result !== 'again'); };
  const check = () => { if (!answer.trim() || !current) return; setChecked(true); onReview(current, correct ? 'good' : 'again', 'cloze'); };
  if (!entries.length) return <div className="page page-enter"><div className="page-heading"><div><span className="eyebrow">ACTIVE RECALL</span><h1>复习，从回忆开始。</h1></div></div><EmptyState icon={<Brain size={28} />} title="还没有可复习的词汇" description="阅读时收藏几个带语境的单词，再回来开始第一轮复习。" action={<Button onClick={onBack}>去书库看看</Button>} /></div>;
  if (!started) return <div className="page review-page page-enter"><div className="page-heading"><div><span className="eyebrow">ACTIVE RECALL</span><h1>先想一想，再看答案。</h1><p>复习不是重读，而是给记忆一次自己站出来的机会。</p></div></div><section className="review-setup glass-panel"><div className="review-orb"><Brain size={36} /></div><span className="eyebrow">TODAY'S SESSION</span><h2>{due || entries.length} 个词汇，正在等你回忆</h2><p>每组最多 20 个词。结果只用于调整你自己的复习节奏。</p>{plan && <div className="plan-banner"><span className="eyebrow">{plan.source === 'fallback' ? '本地计划 · 今日' : 'PATHMORA · 今日'}{plan.todayMinutes}分钟</span><p>{plan.source === 'fallback' ? `pathmora 暂未连接，先按你的学习记录本地排程：先补 ${plan.stats.weakCount} 个薄弱词，再间隔强化。连接 pathmora 后自动升级为大脑下发。完成后去读 ${plan.readingRewardMinutes} 分钟——阅读是奖励。` : `复习顺序由 pathmora 学习大脑下发：先补 ${plan.stats.weakCount} 个薄弱词，再间隔强化已掌握词。完成后去读 ${plan.readingRewardMinutes} 分钟——阅读是奖励，不被复习挤占。`}</p></div>}<div className="review-mode"><label>选择练习方式</label><Segmented value={mode} onChange={setMode} label="复习模式" options={[{ value: 'flashcard', label: 'Flashcards' }, { value: 'cloze', label: '原文挖空' }]} /></div><div className="mode-description">{mode === 'flashcard' ? <><Sparkles size={17} /><span>先看单词主动回忆，再揭示释义与原句，最后评估熟悉程度。</span></> : <><CheckCircle2 size={17} /><span>从你收藏的原句中挖空，输入正确单词后获得即时反馈。</span></>}</div><Button size="lg" onClick={start}>开始本次复习<ArrowRight size={18} /></Button></section><div className="review-principles"><div><strong>Recall</strong><span>先主动提取</span></div><div><strong>Context</strong><span>再回到语境</span></div><div><strong>Return</strong><span>按熟练度重现</span></div></div></div>;
  if (finished) return <div className="page review-page page-enter"><section className="review-complete glass-panel"><div className="review-orb"><Check size={38} /></div><span className="eyebrow">SESSION COMPLETE</span><h1>这一轮，完成了。</h1><p>你认真回忆了 {queue.length} 个词，其中 {score} 个顺利通过。</p><div className="completion-score"><strong>{Math.round((score / queue.length) * 100)}%</strong><span>本轮回忆率</span></div><div className="completion-actions"><Button variant="secondary" onClick={() => setStarted(false)}>返回复习首页</Button><Button onClick={start}><RotateCcw size={17} />再来一轮</Button></div></section></div>;
  return <div className="page review-session page-enter"><div className="session-head"><Button variant="ghost" size="sm" onClick={() => setStarted(false)}><ArrowLeft size={16} />结束本轮</Button><div><span>{index + 1} / {queue.length}</span><ProgressBar value={((index + 1) / queue.length) * 100} /></div><span className="mode-pill">{mode === 'flashcard' ? 'FLASHCARD' : 'FILL THE GAP'}</span></div>
    {mode === 'flashcard' ? <section className={`study-card glass-panel ${revealed ? 'revealed' : ''}`}><div className="study-card-source">{current.bookTitle} · {current.chapterTitle}</div><div className="study-word"><span className="eyebrow">DO YOU REMEMBER?</span><h1>{current.word}</h1><p>{current.dictionary?.phonetic}</p></div>{revealed ? <div className="study-answer"><h3>{current.dictionary?.chinese || '未保存释义'}</h3><p>{current.dictionary?.meaning}</p><blockquote>{current.context}</blockquote>{current.dictionary && <div className="example-box"><p>{current.dictionary.example}</p><span>{current.dictionary.exampleCn}</span></div>}</div> : <button className="reveal-button" onClick={() => setRevealed(true)}>想好了，显示答案</button>}</section> : <section className="study-card glass-panel"><div className="study-card-source">{current.bookTitle} · {current.chapterTitle}</div><div className="cloze-content"><span className="eyebrow">COMPLETE THE ORIGINAL SENTENCE</span><blockquote>{cloze}</blockquote>{!checked ? <form onSubmit={(event) => { event.preventDefault(); check(); }}><input autoFocus value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="输入缺失的英文单词" autoCapitalize="none" autoComplete="off" /><Button type="submit" disabled={!answer.trim()}>检查答案</Button></form> : <div className={`cloze-feedback ${correct ? 'correct' : 'wrong'}`}><div>{correct ? <CheckCircle2 size={22} /> : <X size={22} />}<strong>{correct ? '答对了，语境也再读一遍。' : `正确答案是 ${current.word}`}</strong></div><p>{current.dictionary?.chinese} · {current.dictionary?.meaning}</p></div>}</div></section>}
    <div className="rating-bar">{mode === 'flashcard' && revealed ? <><span>这次回忆怎么样？</span><div><Button variant="secondary" onClick={() => rate('again')}>陌生</Button><Button variant="secondary" onClick={() => rate('hard')}>模糊</Button><Button variant="secondary" onClick={() => rate('good')}>记得</Button><Button onClick={() => rate('easy')}>熟悉</Button></div></> : mode === 'flashcard' ? <span>先在脑中说出意思，不要急着翻答案。</span> : checked ? <Button onClick={() => next(correct)}>下一个词<ArrowRight size={17} /></Button> : <span>答案会保存在你的复习记录中。</span>}</div>
  </div>;
}
