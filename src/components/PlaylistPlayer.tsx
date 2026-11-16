import { useEffect, useRef, useState } from 'react';
import { BookOpen, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import type { Book } from '../types';
import { getBookAudio } from '../lib/db';
import { nextIndex, prevIndex } from '../lib/playlist';

const RATES = [0.8, 1, 1.15, 1.3, 1.5, 1.75, 2];

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const p = (x: number) => String(x).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

/**
 * 课程连续播放器：按播放列表顺序播放各书音频，一曲结束自动切下一首，
 * 无音频的书自动跳过（队列只前进不循环，故必然终止）。音频解析异步，
 * 用 audioLoaded 标记区分「还没解析完」与「确实没有音频」，避免误跳过。
 */
export default function PlaylistPlayer({ books, onOpenBook }: { books: Book[]; onOpenBook: (book: Book) => void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | undefined>(undefined);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [src, setSrc] = useState<string | undefined>(undefined);
  const [audioLoaded, setAudioLoaded] = useState(false);
  const playingRef = useRef(playing);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  const book = books[currentIndex];
  const bookId = book?.id;

  // 解析当前书的音频：静态 book.audio 优先用，否则查 IndexedDB 用户绑定音频。
  useEffect(() => {
    let active = true;
    setAudioLoaded(false); setCur(0); setDur(0);
    const release = () => { if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = undefined; } };
    if (!bookId) { release(); setSrc(undefined); setAudioLoaded(true); return; }
    const current = books.find((b) => b.id === bookId);
    if (current?.audio) { release(); setSrc(current.audio); setAudioLoaded(true); return; }
    void getBookAudio(bookId).then((blob) => {
      if (!active) return;
      release();
      if (blob) { const url = URL.createObjectURL(blob); objectUrlRef.current = url; setSrc(url); }
      else setSrc(undefined);
      setAudioLoaded(true);
    }).catch(() => { if (active) { release(); setSrc(undefined); setAudioLoaded(true); } });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, bookId]);

  // 卸载时释放 object URL。
  useEffect(() => () => { if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current); }, []);

  const advance = () => {
    const n = nextIndex(currentIndex, books.length);
    if (n == null) setPlaying(false);
    else setCurrentIndex(n);
  };

  // 音频就绪后：无音频→自动跳到下一首；有音频且正在播放→接着播。
  useEffect(() => {
    if (!audioLoaded) return;
    if (!src) { advance(); return; }
    const audio = audioRef.current;
    if (audio) { audio.playbackRate = rate; if (playingRef.current) audio.play().catch(() => setPlaying(false)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioLoaded, src, currentIndex]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || !src) return;
    if (audio.paused) audio.play().catch(() => setPlaying(false));
    else audio.pause();
  };
  const goPrev = () => { const n = prevIndex(currentIndex); if (n != null) setCurrentIndex(n); };
  const goNext = () => { const n = nextIndex(currentIndex, books.length); if (n != null) setCurrentIndex(n); };
  const seek = (ratio: number) => { const audio = audioRef.current; if (audio && audio.duration) audio.currentTime = Math.max(0, Math.min(1, ratio)) * audio.duration; };
  const cycleRate = () => { const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length]; setRate(next); const audio = audioRef.current; if (audio) audio.playbackRate = next; };

  if (!books.length) return <p className="playlist-empty muted">这个播放列表里没有可播放的书。先在书卡上点「加入播放列表」添加带音频的书或课程。</p>;

  return <div className="playlist-player">
    <audio ref={audioRef} src={src} preload="metadata"
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onEnded={advance}
      onLoadedMetadata={(e) => setDur((e.target as HTMLAudioElement).duration || 0)}
      onTimeUpdate={(e) => setCur((e.target as HTMLAudioElement).currentTime)} />

    <div className="player-now">
      <span className="player-index">{currentIndex + 1} / {books.length}</span>
      <h3 className="player-title">{book?.title || '—'}</h3>
      {book && <button className="player-open" onClick={() => onOpenBook(book)}><BookOpen size={14} />打开这本书</button>}
    </div>

    <div className="player-seek">
      <span className="audiobar-time">{fmt(cur)}</span>
      <input className="audiobar-range" type="range" min={0} max={dur || 1} step={0.1} value={cur} onChange={(e) => seek(Number(e.target.value) / (dur || 1))} aria-label="播放进度" />
      <span className="audiobar-time dim">{fmt(dur)}</span>
    </div>

    <div className="player-controls">
      <button className="icon-button" onClick={goPrev} disabled={currentIndex === 0} aria-label="上一首"><SkipBack size={18} /></button>
      <button className="icon-button player-play" onClick={togglePlay} disabled={!src} aria-label={playing ? '暂停' : '播放'}>{playing ? <Pause size={22} /> : <Play size={22} />}</button>
      <button className="icon-button" onClick={goNext} disabled={currentIndex >= books.length - 1} aria-label="下一首"><SkipForward size={18} /></button>
      <button className="chip" onClick={cycleRate} title="播放速度">{rate.toFixed(2).replace(/0$/, '')}×</button>
      {!audioLoaded && <span className="muted player-status">解析音频…</span>}
      {audioLoaded && !src && <span className="muted player-status">无音频，跳过…</span>}
    </div>

    <ul className="player-tracks">{books.map((b, index) => <li key={b.id}><button className={`player-track ${index === currentIndex ? 'current' : ''}`} onClick={() => setCurrentIndex(index)} aria-label={`播放 ${b.title}`}><span className="track-index">{index + 1}</span><span className="track-title">{b.title}</span>{index === currentIndex && playing && <Play size={13} />}</button></li>)}</ul>
  </div>;
}
