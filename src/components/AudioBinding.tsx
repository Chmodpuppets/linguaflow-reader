import { useEffect, useRef, useState } from 'react';
import { AudioLines, Check, Loader2, Sparkles, Trash2, Unlink, Upload } from 'lucide-react';
import type { Book } from '../types';
import { deleteAlignment, deleteBookAudio, getAlignment, getBookAudio, listAlignmentIds, listBookAudioIds, saveAlignment, saveBookAudio } from '../lib/db';
import { notifyBookAudioChanged } from '../lib/bookAudio';
import { clearAlignment, registerAlignment } from '../lib/audioAlign';
import { AlignmentCancelled, MAX_ALIGN_BYTES, buildBookAlignment, type AlignProgress } from '../lib/bookAlignment';
import { Button } from './UI';

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|flac|webm|opus)$/i;

interface AlignmentMeta { lineCount: number; createdAt: string }
interface AlignJob { bookId: string; progress: AlignProgress }

function formatSize(bytes: number): string {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * 为任意一本书绑定用户自己的原声音频，并在浏览器里本地生成句级定位。
 *
 * 音频 Blob 存 IndexedDB book-audio store，对齐结果存 alignment store；
 * 两者都不进 AppData、不进 JSON 备份、不上传。绑定状态与对齐状态都从 IndexedDB 读，
 * 因此刷新后不丢（绕开 App.tsx 的 slimForStorage / hydrateBooks 覆盖）。
 */
export default function AudioBinding({ books, onNotify }: { books: Book[]; onNotify?: (message: string) => void }) {
  const [bound, setBound] = useState<Set<string>>(new Set());
  const [alignments, setAlignments] = useState<Record<string, AlignmentMeta>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [targetId, setTargetId] = useState('');
  const [job, setJob] = useState<AlignJob | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);

  const refresh = async () => {
    try {
      const [audioIds, alignIds] = await Promise.all([listBookAudioIds(), listAlignmentIds()]);
      setBound(new Set(audioIds));
      const meta: Record<string, AlignmentMeta> = {};
      await Promise.all(alignIds.map(async (id) => {
        try {
          const alignment = await getAlignment(id);
          if (alignment) meta[id] = { lineCount: alignment.lineCount, createdAt: alignment.createdAt };
        } catch { /* 单本读取失败不影响其它书 */ }
      }));
      setAlignments(meta);
    } catch { /* IndexedDB 不可用时保持空状态，不阻塞设置页 */ }
  };
  useEffect(() => { void refresh(); }, []);

  const say = (text: string) => { setMessage(text); onNotify?.(text); };

  const pick = (bookId: string) => {
    setTargetId(bookId);
    setMessage('');
    if (fileRef.current) { fileRef.current.value = ''; fileRef.current.click(); }
  };

  const bind = async (file?: File) => {
    if (!file || !targetId) return;
    if (!file.type.startsWith('audio/') && !AUDIO_EXT.test(file.name)) { say('请选择音频文件（mp3 / m4a / wav / ogg 等）。'); return; }
    const book = books.find((item) => item.id === targetId);
    setBusy(targetId);
    try {
      await saveBookAudio(targetId, file);
      // 换了音频，旧的句级时间戳必然失效，必须一起清掉，否则会跳到错误位置。
      await deleteAlignment(targetId).catch(() => undefined);
      clearAlignment(targetId);
      notifyBookAudioChanged(targetId);
      await refresh();
      say(`已为《${book?.title || '这本书'}》绑定原音 · ${formatSize(file.size)}${file.size > MAX_ALIGN_BYTES ? '（超过句级定位上限，仍可整段播放）' : ''}`);
    } catch { say('音频保存失败：浏览器存储空间不足或 IndexedDB 不可用。'); }
    finally { setBusy(null); }
  };

  const unbind = async (bookId: string) => {
    setBusy(bookId);
    try {
      await deleteBookAudio(bookId);
      await deleteAlignment(bookId).catch(() => undefined);
      clearAlignment(bookId);
      notifyBookAudioChanged(bookId);
      await refresh();
      say('已移除本机原音与句级定位，恢复为内置音频或 TTS 示范。');
    } catch { say('移除失败，请重试。'); }
    finally { setBusy(null); }
  };

  const runAlign = async (bookId: string) => {
    const book = books.find((item) => item.id === bookId);
    if (!book) return;
    try {
      const blob = await getBookAudio(bookId);
      if (!blob) { say('请先为这本书绑定原声音频。'); return; }
      if (blob.size > MAX_ALIGN_BYTES) {
        say(`音频 ${formatSize(blob.size)} 超过 ${MAX_ALIGN_BYTES / 1048576}MB 上限，请先剪出要练的章节。`);
        return;
      }
      cancelRef.current = false;
      setMessage('');
      setJob({ bookId, progress: { phase: 'decode', progress: 0, label: '准备解码…' } });
      const alignment = await buildBookAlignment(book, blob, {
        onProgress: (progress) => setJob((current) => current?.bookId === bookId ? { ...current, progress } : current),
        isCancelled: () => cancelRef.current,
      });
      setJob((current) => current?.bookId === bookId ? { ...current, progress: { phase: 'save', progress: 100, label: '保存到本机…' } } : current);
      await saveAlignment(bookId, alignment);
      registerAlignment(bookId, alignment.lines);
      notifyBookAudioChanged(bookId);
      await refresh();
      say(`句级定位已生成：${alignment.lineCount} 句 · 覆盖 ${Math.round(alignment.duration)} 秒音频`);
    } catch (error) {
      if (error instanceof AlignmentCancelled) say('已取消生成。');
      else say(`生成失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setJob(null);
      cancelRef.current = false;
    }
  };

  const removeAlign = async (bookId: string) => {
    try {
      await deleteAlignment(bookId);
      clearAlignment(bookId);
      notifyBookAudioChanged(bookId);
      await refresh();
      say('已删除句级定位，恢复整段播放。');
    } catch { say('删除失败，请重试。'); }
  };

  const locked = Boolean(job) || busy !== null;

  return <section className="settings-card glass-panel audio-binding-card">
    <div className="settings-card-head"><AudioLines size={20} /><div><h2>有声书原音</h2><p>绑定你自己的音频，并在本机生成句级定位。</p></div></div>
    <p className="audio-binding-note">支持书库里任意一本书（含自己导入的 EPUB）。音频与对齐结果都存在本机 IndexedDB，<strong>不进 JSON 备份、不会上传</strong>。绑定后阅读页播放条与口语实验室会优先播放它。</p>
    <p className="audio-binding-note dim">句级定位用本地 Whisper 转写 + 文本单调对齐，首次启用需下载 40–80MB 模型；单次音频上限 <strong>{MAX_ALIGN_BYTES / 1048576}MB</strong>（约 16 分钟），整本有声书建议先剪出章节。生成过程全在本机，期间请勿关闭页面。</p>
    <div className="audio-binding-list">
      {books.map((book) => {
        const isBound = bound.has(book.id);
        const aligned = alignments[book.id];
        const running = job?.bookId === book.id;
        return <div className="audio-binding-row" key={book.id}>
          <div className="audio-binding-name">
            <strong>{book.title}</strong>
            <span className={isBound ? 'bound' : ''}>
              {isBound ? '已绑定本机原音' : book.audio ? '内置音频' : '未绑定'}
              {aligned ? ` · 已定位 ${aligned.lineCount} 句` : ''}
            </span>
          </div>
          <div className="audio-binding-actions">
            {isBound && !running && <Button variant="ghost" size="sm" disabled={locked} onClick={() => void runAlign(book.id)}><Sparkles size={14} />{aligned ? '重新定位' : '生成句级定位'}</Button>}
            {aligned && !running && <Button variant="ghost" size="sm" disabled={locked} onClick={() => void removeAlign(book.id)}><Trash2 size={14} />删定位</Button>}
            {isBound
              ? <Button variant="ghost" size="sm" disabled={locked} onClick={() => void unbind(book.id)}><Unlink size={14} />移除音频</Button>
              : <Button variant="secondary" size="sm" disabled={locked} onClick={() => pick(book.id)}><Upload size={14} />绑定音频</Button>}
          </div>
        </div>;
      })}
      {!books.length && <p className="audio-binding-empty muted">书库还是空的，先导入一本书吧。</p>}
    </div>
    {job && <div className="audio-align-job">
      <div className="audio-align-job-head"><span><Loader2 size={13} className="spin" />{job.progress.label}</span><Button variant="ghost" size="sm" onClick={() => { cancelRef.current = true; }}>取消</Button></div>
      <div className="audio-align-progress"><span style={{ width: `${Math.min(100, Math.max(3, job.progress.progress))}%` }} /></div>
    </div>}
    {message && <p className="audio-binding-message"><Check size={13} />{message}</p>}
    <input ref={fileRef} hidden type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac,.webm,.opus" onChange={(event) => void bind(event.target.files?.[0])} />
  </section>;
}
