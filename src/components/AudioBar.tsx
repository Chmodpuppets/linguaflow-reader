import { useCallback, useEffect, useRef, useState } from 'react';
import { Link2, Pause, Pin, Play, RotateCcw, RotateCw } from 'lucide-react';
import type { Book } from '../types';

type Anchors = Record<number, number>;
const RATES = [0.8, 1, 1.15, 1.3, 1.5, 1.75, 2];
const storageKey = (bookId: string) => `lf-audio:${bookId}`;

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const p = (x: number) => String(x).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

/**
 * 有声书播放条：播放/暂停、±15s、变速、进度拖动，以及「逐页锚点」——
 * 手动锚定本页，或打开「打点」边听边翻页自动记录每页起点，再开「联动」翻页即跳音频。
 */
export default function AudioBar({ book, src, page, onNotify }: { book: Book; src: string; page: number; onNotify: (message: string) => void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [rate, setRate] = useState(1);
  const [anchors, setAnchors] = useState<Anchors>({});
  const [link, setLink] = useState(false);
  const [punch, setPunch] = useState(false);

  // refs 供翻页 effect 读最新值
  const anchorsRef = useRef<Anchors>(anchors);
  const linkRef = useRef(link);
  const punchRef = useRef(punch);
  useEffect(() => { anchorsRef.current = anchors; }, [anchors]);
  useEffect(() => { linkRef.current = link; }, [link]);
  useEffect(() => { punchRef.current = punch; }, [punch]);

  const persist = useCallback((a: Anchors, l: boolean) => {
    try { localStorage.setItem(storageKey(book.id), JSON.stringify({ anchors: a, link: l })); } catch { /* ignore */ }
  }, [book.id]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(book.id));
      if (raw) {
        const d = JSON.parse(raw);
        if (d.anchors && typeof d.anchors === 'object') setAnchors(d.anchors);
        if (typeof d.link === 'boolean') setLink(d.link);
      }
    } catch { /* ignore */ }
  }, [book.id]);

  // 翻页联动 / 打点
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    if (punchRef.current) {
      if (audio.paused) { onNotify('打点需要先播放'); return; }
      const prev = anchorsRef.current;
      if (prev[page] == null) {
        const next = { ...prev, [page]: audio.currentTime };
        setAnchors(next);
        persist(next, linkRef.current);
      }
    } else if (linkRef.current) {
      const keys = Object.keys(anchorsRef.current).map(Number).filter((n) => n <= page).sort((a, b) => a - b);
      const target = keys.length ? anchorsRef.current[keys[keys.length - 1]] : null;
      if (target != null && Math.abs(audio.currentTime - target) > 0.8) audio.currentTime = target;
    }
    // 仅在翻页时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => onNotify('音频加载失败'));
    else audio.pause();
  };

  const seek = (ratio: number) => {
    const audio = audioRef.current;
    if (audio && audio.duration) audio.currentTime = Math.max(0, Math.min(1, ratio)) * audio.duration;
  };

  const skip = (delta: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + delta));
  };

  const cycleRate = () => {
    const audio = audioRef.current;
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    if (audio) audio.playbackRate = next;
  };

  const toggleLink = () => {
    const next = !linkRef.current;
    setLink(next);
    persist(anchorsRef.current, next);
    onNotify(next ? '联动已开：翻页自动跳到本页音频' : '联动已关');
  };

  const togglePunch = () => {
    const next = !punchRef.current;
    setPunch(next);
    if (next) {
      setLink(false);
      persist(anchorsRef.current, false);
      onNotify('打点模式：边听边翻页，自动记录每页起点');
    } else {
      onNotify(`打点结束，共 ${Object.keys(anchorsRef.current).length} 页有锚点`);
    }
  };

  const anchorHere = () => {
    const audio = audioRef.current;
    const t = audio ? audio.currentTime : 0;
    if (!t) { onNotify('先播放一点，再锚定本页'); return; }
    const prev = anchorsRef.current;
    const existing = prev[page];
    if (existing != null && Math.abs(existing - t) < 2.5) {
      const { [page]: _removed, ...rest } = prev;
      setAnchors(rest);
      persist(rest, linkRef.current);
      onNotify(`已清除第 ${page} 页锚点`);
    } else {
      const next = { ...prev, [page]: t };
      setAnchors(next);
      persist(next, linkRef.current);
      onNotify(`第 ${page} 页 ↔ ${fmt(t)} 已锚定`);
    }
  };

  const anchored = anchors[page] != null;
  const count = Object.keys(anchors).length;
  // 打点分母按书实际页数算，不再写死内置扫描书的 226。
  const pageCount = book.pageImages ? Object.keys(book.pageImages).length : book.chapters.length;

  return (
    <div className="audiobar glass-panel">
      <audio ref={audioRef} src={src} preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDur((e.target as HTMLAudioElement).duration || 0)}
        onTimeUpdate={(e) => setCur((e.target as HTMLAudioElement).currentTime)} />

      <button className="icon-button audiobar-play" onClick={togglePlay} aria-label={playing ? '暂停' : '播放'}>
        {playing ? <Pause size={20} /> : <Play size={20} />}
      </button>

      <div className="audiobar-seek">
        <div className="audiobar-row">
          <span className="audiobar-time">{fmt(cur)}</span>
          <input className="audiobar-range" type="range" min={0} max={dur || 1} step={0.1} value={cur}
            onChange={(e) => seek(Number(e.target.value) / (dur || 1))} aria-label="音频进度" />
          <span className="audiobar-time dim">{fmt(dur)}</span>
        </div>
        <div className="audiobar-row audiobar-controls">
          <button className="chip" onClick={() => skip(-15)} title="后退 15 秒"><RotateCcw size={13} />15s</button>
          <button className="chip" onClick={() => skip(15)} title="前进 15 秒"><RotateCw size={13} />15s</button>
          <button className="chip" onClick={cycleRate} title="播放速度">{rate.toFixed(2).replace(/0$/, '')}×</button>
          <button className={`chip ${link ? 'on' : ''}`} onClick={toggleLink} title="翻页自动跳到本页音频"><Link2 size={13} />联动 {link ? '开' : '关'}</button>
          <button className={`chip ${punch ? 'on' : ''}`} onClick={togglePunch} title="边听边翻页，自动记每页起点">打点 {punch ? `${count}/${pageCount}` : '关'}</button>
          <button className={`chip accent ${anchored ? 'on' : ''}`} onClick={anchorHere} title="把当前音频时间锚定到本页"><Pin size={13} />{anchored ? `已锚 ${fmt(anchors[page])}` : '锚定本页'}</button>
        </div>
      </div>
    </div>
  );
}
