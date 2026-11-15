import { useRef, useState } from 'react';
import { AudioLines, Captions, Check, FileAudio, Loader2, Sparkles, X } from 'lucide-react';
import type { Book } from '../types';
import { Button, ProgressBar } from './UI';
import { buildLesson, buildLessonFromSubtitles, type LessonResult } from '../lib/lessonBuilder';
import { MAX_ALIGN_BYTES, type AlignProgress } from '../lib/bookAlignment';
import { WHISPER_MODELS, DEFAULT_WHISPER_MODEL, isWhisperSupported, type WhisperModelId } from '../lib/whisper';
import { isSubtitleFile, parseSubtitles, type SubtitleCue } from '../lib/subtitle';

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|flac|webm|opus|mp4|m4v|mov)$/i;

function formatSize(bytes: number): string {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * 音频 / 字幕一键建课：
 *   · 字幕（.srt / .vtt）：字幕自带精确句级时间轴，无需语音识别，秒建课程；配套音频可选。
 *   · 音频（可选贴入文稿）：本地 Whisper 转写 / 对齐生成课程。
 * 全程离线，音频与时间轴不上传。
 */
export default function LessonBuilder({ onCreated }: { onCreated: (book: Book) => void }) {
  const [audio, setAudio] = useState<File | null>(null);
  const [subtitle, setSubtitle] = useState<File | null>(null);
  const [cues, setCues] = useState<SubtitleCue[] | null>(null);
  const [title, setTitle] = useState('');
  const [transcript, setTranscript] = useState('');
  const [model, setModel] = useState<WhisperModelId>(DEFAULT_WHISPER_MODEL);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<AlignProgress | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<LessonResult | null>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const subtitleRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const supported = isWhisperSupported();
  const hasSubtitle = !!cues && cues.length >= 2;

  const pickAudio = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('audio/') && !file.type.startsWith('video/') && !AUDIO_EXT.test(file.name)) { setError('请选择音频或视频文件（mp3 / m4a / wav / mp4 等）。'); return; }
    setError('');
    setAudio(file);
    if (!title.trim()) setTitle(file.name.replace(AUDIO_EXT, '').slice(0, 60));
  };

  const pickSubtitle = async (file?: File) => {
    if (!file) return;
    if (!isSubtitleFile(file.name)) { setError('请选择字幕文件（.srt / .vtt）。'); return; }
    try {
      const parsed = parseSubtitles(await file.text());
      if (parsed.length < 2) { setError('这份字幕里没有足够的语句，请确认是有效的 SRT / VTT 文件。'); return; }
      setError('');
      setSubtitle(file);
      setCues(parsed);
      if (!title.trim()) setTitle(file.name.replace(/\.(srt|vtt)$/i, '').slice(0, 60));
    } catch {
      setError('读取字幕失败，请重试。');
    }
  };

  const build = async () => {
    if (busy) return;
    if (!hasSubtitle && !audio) return;
    setBusy(true); setError(''); setResult(null); setProgress({ phase: 'decode', progress: 0, label: '准备…' });
    cancelRef.current = false;
    try {
      const lesson = hasSubtitle
        ? await buildLessonFromSubtitles(cues!, { title: title.trim() || undefined, audio: audio || undefined, onProgress: setProgress })
        : await buildLesson(audio!, {
          title: title.trim() || undefined,
          text: transcript.trim() || undefined,
          model,
          onProgress: setProgress,
          isCancelled: () => cancelRef.current,
        });
      setResult(lesson);
      onCreated(lesson.book);
    } catch (err) {
      setError(err instanceof Error ? err.message : '建课失败，请检查文件后重试。');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const modeLabel = result?.mode === 'subtitle' ? '字幕精确时间轴' : result?.mode === 'transcribed' ? '语音识别生成' : '文稿对齐';
  const canBuild = hasSubtitle || (!!audio && supported && audio.size <= MAX_ALIGN_BYTES);

  return <div className="lesson-builder">
    <div className="lesson-intro"><AudioLines size={18} /><p>{hasSubtitle
      ? '字幕自带每一句的精确时间位置，无需语音识别即可建课：边听边看、点词查义、逐句跟读。可再选配套音频/视频用于播放。'
      : '把一段音频变成可跟读的课程：本地识别每一句的时间位置。也可以直接选一份字幕（.srt / .vtt），用精确时间轴秒建课程。'}</p></div>

    <div className={`lesson-audio lesson-subtitle ${subtitle ? 'has-audio' : ''}`} onClick={() => !busy && subtitleRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' && !busy) subtitleRef.current?.click(); }}>
      <Captions size={24} />
      {subtitle && cues ? <div className="lesson-audio-meta"><strong>{subtitle.name}</strong><span>{cues.length} 句 · 精确时间轴 · 无需识别模型</span></div> : <div className="lesson-audio-meta"><strong>选择字幕文件（推荐）</strong><span>.srt / .vtt · 自带精确时间轴，无需下载模型</span></div>}
      {subtitle && !busy && <button className="icon-button subtle" onClick={(e) => { e.stopPropagation(); setSubtitle(null); setCues(null); }} aria-label="移除字幕"><X size={15} /></button>}
      <input ref={subtitleRef} type="file" hidden accept=".srt,.vtt,application/x-subrip,text/vtt" onChange={(e) => void pickSubtitle(e.target.files?.[0] || undefined)} />
    </div>

    <div className={`lesson-audio lesson-audio-file ${audio ? 'has-audio' : ''}`} onClick={() => !busy && audioRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' && !busy) audioRef.current?.click(); }}>
      <FileAudio size={24} />
      {audio ? <div className="lesson-audio-meta"><strong>{audio.name}</strong><span>{formatSize(audio.size)}{audio.size > MAX_ALIGN_BYTES ? ' · 超过 16MB 上限，请剪短' : ''}</span></div> : <div className="lesson-audio-meta"><strong>{hasSubtitle ? '配套音频 / 视频（可选）' : '选择音频文件'}</strong><span>{hasSubtitle ? '绑定后可播放；不选也能阅读 + 看时间轴' : 'mp3 / m4a / wav / ogg · ≤ 16MB（约 16 分钟）'}</span></div>}
      {audio && !busy && <button className="icon-button subtle" onClick={(e) => { e.stopPropagation(); setAudio(null); }} aria-label="移除音频"><X size={15} /></button>}
      <input ref={audioRef} type="file" hidden accept="audio/*,video/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.flac,.webm,.opus,.mp4,.m4v,.mov" onChange={(e) => pickAudio(e.target.files?.[0] || undefined)} />
    </div>

    <label className="field"><span>课程标题（可选）</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：TED 演讲 · 习惯的力量" disabled={busy} /></label>

    {!hasSubtitle && <>
      {!supported && <p className="lesson-error">当前浏览器不支持本地语音识别（需要 WebAssembly 与 Web Worker）。可改用字幕文件建课，或导入文本 / EPUB / PDF 阅读。</p>}
      <label className="field"><span>文稿（可选 · 提供后对齐更准）</span><textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={5} placeholder="粘贴这段音频的英文原文。留空则自动语音识别生成课文。" disabled={busy} /></label>
      <label className="field"><span>识别模型</span><select value={model} onChange={(e) => setModel(e.target.value as WhisperModelId)} disabled={busy}>{WHISPER_MODELS.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.note}（{m.size}）</option>)}</select></label>
    </>}

    {busy && progress && <div className="lesson-progress"><div className="lesson-progress-head"><span><Loader2 size={14} className="spin" />{progress.label}</span><Button variant="ghost" size="sm" onClick={() => { cancelRef.current = true; }}>取消</Button></div><ProgressBar value={progress.progress} /><span className="lesson-progress-pct">{progress.progress}%</span></div>}

    {error && <p className="lesson-error">{error}</p>}
    {result && <p className="lesson-success"><Check size={14} />已建课《{result.book.title}》· {result.alignment.lineCount} 句 · {modeLabel}</p>}

    <div className="lesson-actions"><Button onClick={() => void build()} disabled={!canBuild || busy}>{busy ? <><Loader2 size={16} className="spin" />正在建课…</> : <><Sparkles size={16} />一键建课</>}</Button></div>
    <p className="lesson-note">{hasSubtitle ? '字幕时间轴与配套音频只存在你的浏览器里，不上传、不进备份。' : '音频与时间轴只存在你的浏览器里，不上传、不进备份。首次使用需下载识别模型（约 40–80MB）；用字幕则无需下载。'}</p>
  </div>;
}
