import { useRef, useState } from 'react';
import { AudioLines, Check, FileAudio, Loader2, Sparkles, X } from 'lucide-react';
import type { Book } from '../types';
import { Button, ProgressBar } from './UI';
import { buildLesson, type LessonResult } from '../lib/lessonBuilder';
import { MAX_ALIGN_BYTES, type AlignProgress } from '../lib/bookAlignment';
import { WHISPER_MODELS, DEFAULT_WHISPER_MODEL, isWhisperSupported, type WhisperModelId } from '../lib/whisper';

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|flac|webm|opus)$/i;

function formatSize(bytes: number): string {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * 音频 + 文本一键建课：选一段音频（可选贴入文稿）→ 本地 Whisper 转写 / 对齐 →
 * 生成可阅读、可点词、可句级跟读定位的课程。全程离线，音频不上传。
 */
export default function LessonBuilder({ onCreated }: { onCreated: (book: Book) => void }) {
  const [audio, setAudio] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [transcript, setTranscript] = useState('');
  const [model, setModel] = useState<WhisperModelId>(DEFAULT_WHISPER_MODEL);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<AlignProgress | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<LessonResult | null>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const supported = isWhisperSupported();

  const pickAudio = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('audio/') && !AUDIO_EXT.test(file.name)) { setError('请选择音频文件（mp3 / m4a / wav / ogg 等）。'); return; }
    setError('');
    setAudio(file);
    if (!title.trim()) setTitle(file.name.replace(AUDIO_EXT, '').slice(0, 60));
  };

  const build = async () => {
    if (!audio || busy) return;
    setBusy(true); setError(''); setResult(null); setProgress({ phase: 'decode', progress: 0, label: '准备…' });
    cancelRef.current = false;
    try {
      const lesson = await buildLesson(audio, {
        title: title.trim() || undefined,
        text: transcript.trim() || undefined,
        model,
        onProgress: setProgress,
        isCancelled: () => cancelRef.current,
      });
      setResult(lesson);
      onCreated(lesson.book);
    } catch (err) {
      setError(err instanceof Error ? err.message : '建课失败，请检查音频后重试。');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return <div className="lesson-builder">
    <div className="lesson-intro"><AudioLines size={18} /><p>把一段音频变成可跟读的课程：本地识别每一句的时间位置，边听边看、点词查义、逐句跟读。{transcript.trim() ? '已提供文稿，将与音频精确对齐。' : '未提供文稿时，直接用本地语音识别生成课文。'}</p></div>

    {!supported && <p className="lesson-error">当前浏览器不支持本地语音识别（需要 WebAssembly 与 Web Worker）。仍可导入文本 / EPUB / PDF 阅读。</p>}

    <div className={`lesson-audio ${audio ? 'has-audio' : ''}`} onClick={() => !busy && audioRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' && !busy) audioRef.current?.click(); }}>
      <FileAudio size={24} />
      {audio ? <div className="lesson-audio-meta"><strong>{audio.name}</strong><span>{formatSize(audio.size)}{audio.size > MAX_ALIGN_BYTES ? ' · 超过 16MB 上限，请剪短' : ''}</span></div> : <div className="lesson-audio-meta"><strong>选择音频文件</strong><span>mp3 / m4a / wav / ogg · ≤ 16MB（约 16 分钟）</span></div>}
      {audio && !busy && <button className="icon-button subtle" onClick={(e) => { e.stopPropagation(); setAudio(null); }} aria-label="移除音频"><X size={15} /></button>}
      <input ref={audioRef} type="file" hidden accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.flac,.webm,.opus" onChange={(e) => pickAudio(e.target.files?.[0] || undefined)} />
    </div>

    <label className="field"><span>课程标题（可选）</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：TED 演讲 · 习惯的力量" disabled={busy} /></label>

    <label className="field"><span>文稿（可选 · 提供后对齐更准）</span><textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={5} placeholder="粘贴这段音频的英文原文。留空则自动语音识别生成课文。" disabled={busy} /></label>

    <label className="field"><span>识别模型</span><select value={model} onChange={(e) => setModel(e.target.value as WhisperModelId)} disabled={busy}>{WHISPER_MODELS.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.note}（{m.size}）</option>)}</select></label>

    {busy && progress && <div className="lesson-progress"><div className="lesson-progress-head"><span><Loader2 size={14} className="spin" />{progress.label}</span><Button variant="ghost" size="sm" onClick={() => { cancelRef.current = true; }}>取消</Button></div><ProgressBar value={progress.progress} /><span className="lesson-progress-pct">{progress.progress}%</span></div>}

    {error && <p className="lesson-error">{error}</p>}
    {result && <p className="lesson-success"><Check size={14} />已建课《{result.book.title}》· {result.alignment.lineCount} 句 · {result.mode === 'transcribed' ? '语音识别生成' : '文稿对齐'}</p>}

    <div className="lesson-actions"><Button onClick={() => void build()} disabled={!audio || busy || !supported || (audio ? audio.size > MAX_ALIGN_BYTES : false)}>{busy ? <><Loader2 size={16} className="spin" />正在建课…</> : <><Sparkles size={16} />一键建课</>}</Button></div>
    <p className="lesson-note">音频与时间轴只存在你的浏览器里，不上传、不进备份。首次使用需下载识别模型（约 40–80MB）。</p>
  </div>;
}
