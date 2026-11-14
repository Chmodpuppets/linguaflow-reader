import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Check, Cpu, Mic, Pause, Play, RotateCcw, Square, Volume2, Zap } from 'lucide-react';
import type { VoiceMode, VoiceRecord } from '../types';
import { alignmentSource, findAudioSpan, loadAlignment } from '../lib/audioAlign';
import { BOOK_AUDIO_EVENT, useBookAudioSrc } from '../lib/bookAudio';
import { diffTranscript, formatDuration, speechRecognitionFactory, voiceMetrics, wordTokens, type SpeechRecognitionLike } from '../lib/voice';
import { DEFAULT_WHISPER_MODEL, WHISPER_MODELS, WHISPER_SOURCE_LABEL, isWhisperLoaded, isWhisperSupported, setWhisperSource, transcribeWithWhisper, warmupWhisper, whisperSource, type WhisperModelId, type WhisperProgress, type WhisperSource } from '../lib/whisper';
import { makeId } from '../lib/utils';
import { classifyProsody, intelligibilityGaps, wordFeaturesFromBuffer, type ProsodyWord } from '../lib/prosody';
import { pickFocus, selfCompareText, SELF_OPTIONS, type FocusPoint } from '../lib/focus';
import { complexityOf, complexitySuggestion, COMPLEXITY_NOTE } from '../lib/complexity';
import { Button } from './UI';

type SttEngine = 'native' | 'whisper';

const ENGINE_KEY = 'lf-voice-engine';

// localStorage 在「阻止所有 Cookie」等环境下会直接抛错；这些函数跑在 useState
// 初始化器里，裸访问会让整个 VoiceLab chunk 渲染即崩。统一吞掉降级为默认值。
function readStored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStored(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* 存储被禁用时仅本次会话内生效 */ }
}

function readEngine(): SttEngine {
  const stored = readStored(ENGINE_KEY);
  if (stored === 'whisper' && isWhisperSupported()) return 'whisper';
  if (stored === 'native') return 'native';
  // 没有原生 STT 的浏览器（Safari / Firefox）默认给本地模型，不然只能手动打字
  return speechRecognitionFactory() ? 'native' : isWhisperSupported() ? 'whisper' : 'native';
}

function readModel(): WhisperModelId {
  const stored = readStored('lf-whisper-model') as WhisperModelId | null;
  return WHISPER_MODELS.some((item) => item.id === stored) ? stored! : DEFAULT_WHISPER_MODEL;
}

function closeAudioContext(context: AudioContext | null): void {
  if (context && context.state !== 'closed') void context.close().catch(() => undefined);
}

function drawWave(canvas: HTMLCanvasElement, analyser: AnalyserNode, color: string): number {
  const context = canvas.getContext('2d')!;
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  const width = canvas.width = canvas.clientWidth * window.devicePixelRatio;
  const height = canvas.height = canvas.clientHeight * window.devicePixelRatio;
  context.clearRect(0, 0, width, height);
  context.strokeStyle = color;
  context.lineWidth = 1.7 * window.devicePixelRatio;
  context.beginPath();
  data.forEach((value, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = (value / 255) * height;
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  });
  context.stroke();
  let sum = 0;
  for (let index = 0; index < data.length; index += 16) sum += Math.abs(data[index] - 128) / 128;
  return sum / (data.length / 16);
}

function ReferenceTrack({ audioUrl, bookId, targetText }: { audioUrl?: string; bookId?: string; targetText: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  // 记录当前 AudioContext 绑定的是哪个 <audio> 元素：playable 切换会重建元素，
  // 旧 context 里的 MediaElementSource 仍连着旧元素，必须重建而不是沿用。
  const connectedElRef = useRef<HTMLAudioElement | null>(null);
  const frameRef = useRef(0);
  const ttsAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [alignmentReady, setAlignmentReady] = useState(false);
  const [broken, setBroken] = useState(false);
  const { src, isUserAudio } = useBookAudioSrc(bookId, audioUrl);
  const playable = broken ? undefined : src;

  useEffect(() => { setBroken(false); }, [src]);
  useEffect(() => {
    let active = true;
    const load = () => { void loadAlignment(bookId).then(() => { if (active) setAlignmentReady(true); }); };
    load();
    // 绑定/解绑音频、生成/删除句级对齐后重新取索引
    window.addEventListener(BOOK_AUDIO_EVENT, load);
    return () => { active = false; window.removeEventListener(BOOK_AUDIO_EVENT, load); };
  }, [bookId]);

  // 运行时对齐（用户为自己音频生成）始终可用；内置静态表只在播内置原音时可用。
  // 内置书换成自己的音频却没生成对齐时，绝不拿旧时间轴硬套。
  const source = alignmentSource(bookId);
  const canSeek = source === 'runtime' || (!isUserAudio && source === 'static');
  const sentence = useMemo(
    () => (alignmentReady && canSeek ? findAudioSpan(bookId, targetText) : null),
    [alignmentReady, canSeek, bookId, targetText],
  );
  const stopAtRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || playable) return;
    const context = canvas.getContext('2d')!;
    const width = canvas.width = canvas.clientWidth * window.devicePixelRatio;
    const height = canvas.height = canvas.clientHeight * window.devicePixelRatio;
    context.strokeStyle = '#8b5cf6';
    context.lineWidth = 2 * window.devicePixelRatio;
    context.beginPath();
    // 没有原音时只画一条静态基线占位，不伪造波形冒充「原音声波」。
    context.moveTo(0, height / 2);
    context.lineTo(width, height / 2);
    context.stroke();
  }, [playable]);

  useEffect(() => () => {
    cancelAnimationFrame(frameRef.current);
    window.speechSynthesis?.cancel();
    closeAudioContext(audioContextRef.current);
    audioContextRef.current = null;
    connectedElRef.current = null;
  }, []);

  // 原音失效（404 / 解绑）时停掉旧元素的波形循环并释放 context，
  // 否则旧 rAF 拿着旧 audio 闭包空转到卸载。
  useEffect(() => {
    if (playable) return;
    cancelAnimationFrame(frameRef.current);
    closeAudioContext(audioContextRef.current);
    audioContextRef.current = null;
    connectedElRef.current = null;
  }, [playable]);

  const visualize = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audioContextRef.current && connectedElRef.current !== audio) {
      cancelAnimationFrame(frameRef.current);
      closeAudioContext(audioContextRef.current);
      audioContextRef.current = null;
    }
    if (!audioContextRef.current) {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      const source = context.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(context.destination);
      audioContextRef.current = context;
      connectedElRef.current = audio;
      const loop = () => {
        if (canvasRef.current && !audio.paused) drawWave(canvasRef.current, analyser, '#8b5cf6');
        frameRef.current = requestAnimationFrame(loop);
      };
      loop();
    }
  };

  const toggle = () => {
    if (!playable) {
      if (!ttsAvailable) return;
      if (playing) { window.speechSynthesis.cancel(); setPlaying(false); return; }
      const utterance = new SpeechSynthesisUtterance(targetText);
      utterance.lang = 'en-US';
      utterance.rate = rate * 0.9;
      utterance.onend = () => setPlaying(false);
      // TTS 失败（无语音包 / 被策略拦截）时不能让 playing 卡在 true。
      utterance.onerror = () => setPlaying(false);
      window.speechSynthesis.speak(utterance);
      setPlaying(true);
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (sentence) { audio.currentTime = sentence.start; stopAtRef.current = sentence.end; }
      else stopAtRef.current = null;
      visualize();
      audio.playbackRate = rate;
      // 404 / 自动播放被拦截时不能让 Promise 悬空；真正的加载失败由 onError 降级到 TTS。
      void audio.play().catch(() => setPlaying(false));
    }
    else audio.pause();
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (audio && stopAtRef.current != null && audio.currentTime >= stopAtRef.current) audio.pause();
  };

  const cycleRate = () => {
    const next = rate === 1 ? 0.8 : rate === 0.8 ? 1.2 : 1;
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  return <div className="reference-track">
    <div className="track-heading"><span><Volume2 size={14} />{playable ? '原音声波' : 'TTS 示范音'}</span><small>{playable ? 'REFERENCE AUDIO' : 'SYSTEM VOICE'}</small></div>
    <canvas ref={canvasRef} className="wave-canvas reference-wave" aria-label={playable ? '原音声波' : '无原音，仅静态占位'} />
    {playable && <audio ref={audioRef} src={playable} preload="metadata" onError={() => setBroken(true)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onTimeUpdate={handleTimeUpdate} />}
    <div className="track-controls"><button className="round-play" onClick={toggle} disabled={!targetText || (!playable && !ttsAvailable)}>{playing ? <Pause size={16} /> : <Play size={16} />}</button><button className="chip" onClick={cycleRate}>{rate}×</button><span>{playable ? '先听节奏，再开始模仿' : ttsAvailable ? '当前无原音，仅作示范预览' : '无原音且此浏览器不支持 TTS 示范'}</span></div>
  </div>;
}

// 焦点词在目标文本里高亮（首个整词命中），让「下一轮只盯它」看得见。
function highlightWord(text: string, word: string) {
  const re = new RegExp(`(^|[^a-zA-Z'])(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=[^a-zA-Z']|$)`, 'i');
  const m = re.exec(text);
  if (!m) return text;
  const start = m.index + m[1].length;
  return <>{text.slice(0, start)}<mark className="focus-mark">{text.slice(start, start + m[2].length)}</mark>{text.slice(start + m[2].length)}</>;
}

export default function VoiceRecorder({ targetText, mode, audioUrl, bookId, noteId, hideTarget = false, maxDuration = 0, challengeWords = [], onActivateWord, onSave, onActiveChange, compact = false }: {
  targetText: string;
  mode: VoiceMode;
  audioUrl?: string;
  bookId?: string;
  noteId?: string;
  hideTarget?: boolean;
  maxDuration?: number;
  challengeWords?: string[];
  onActivateWord?: (word: string) => void;
  /** 返回是否真正落盘成功：写失败时组件不能显示「已保存」。 */
  onSave: (record: VoiceRecord, audio: Blob) => Promise<boolean>;
  /** 录音进行中通知父级（用于切换目标 / 模式前确认，避免静默丢弃录音）。 */
  onActiveChange?: (active: boolean) => void;
  compact?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef(0);
  const chunksRef = useRef<Blob[]>([]);
  const transcriptRef = useRef('');
  const finalTranscriptRef = useRef('');
  const confidenceRef = useRef(1);
  const activatedRef = useRef(new Set<string>());
  const durationRef = useRef(0);
  const silenceRef = useRef({ silent: 0, total: 0 });
  const timerRef = useRef(0);
  // 录音会话 id：每次开始录音 / 切换目标 / 卸载都自增。finalize 里的每个 await
  // 之后都校验会话，旧录音的迟到转写绝不能污染新录音或在卸载后落盘。
  const sessionRef = useRef(0);
  const mountedRef = useRef(true);
  const startingRef = useRef(false);
  const finalizeTimerRef = useRef(0);
  const onActiveChangeRef = useRef(onActiveChange);
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [result, setResult] = useState<VoiceRecord | null>(null);
  const [audioUrlResult, setAudioUrlResult] = useState('');
  const resultUrlRef = useRef('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [manualTranscript, setManualTranscript] = useState('');
  const [sttAvailable] = useState(() => !!speechRecognitionFactory());
  const [whisperSupported] = useState(() => isWhisperSupported());
  const [engine, setEngine] = useState<SttEngine>(readEngine);
  const [model, setModel] = useState<WhisperModelId>(readModel);
  const [source, setSource] = useState<WhisperSource>(whisperSource);
  const [whisper, setWhisper] = useState<WhisperProgress | null>(null);
  const [prosody, setProsody] = useState<ProsodyWord[] | null>(null);
  const [nextFocus, setNextFocus] = useState<FocusPoint | null>(null);
  const [selfReport, setSelfReport] = useState<string | null>(null);
  const [selfSkipped, setSelfSkipped] = useState(false);
  const focus = useMemo(() => result ? pickFocus({ tokens: result.diffTokens, prosody, pauseRatioPct: result.metrics.pauseRatio, fillerCount: result.metrics.fillerCount }) : null, [result, prosody]);
  useEffect(() => { setNextFocus(null); setSelfReport(null); setSelfSkipped(false); }, [result]);
  const showDiag = selfReport !== null || selfSkipped;
  const complexity = useMemo(() => (mode === 'freetalk' && result?.transcript) ? complexityOf(result.transcript) : null, [mode, result]);
  const engineRef = useRef<SttEngine>(engine);
  const modelRef = useRef<WhisperModelId>(model);

  useEffect(() => { engineRef.current = engine; writeStored(ENGINE_KEY, engine); }, [engine]);
  useEffect(() => { modelRef.current = model; writeStored('lf-whisper-model', model); }, [model]);
  useEffect(() => { resultUrlRef.current = audioUrlResult; }, [audioUrlResult]);
  useEffect(() => { onActiveChangeRef.current = onActiveChange; }, [onActiveChange]);
  // 韵律反馈：仅 shadowing 且有原音时，解码原音与录音 → 逐词能量/浊音对齐。
  // 纯前端、失败安静降级（不显示韵律条），不影响录音与 diff 主流程。
  useEffect(() => {
    setProsody(null);
    if (mode !== 'shadowing' || !audioUrl || !result || !audioUrlResult) return;
    const words = wordTokens(result.targetText);
    if (!words.length) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    let cancelled = false;
    const ctx = new Ctx();
    void (async () => {
      try {
        const [origBuf, userBuf] = await Promise.all([
          fetch(audioUrl).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)),
          fetch(audioUrlResult).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)),
        ]);
        if (cancelled) return;
        const target = wordFeaturesFromBuffer(origBuf, words.length);
        const user = wordFeaturesFromBuffer(userBuf, words.length);
        setProsody(classifyProsody(words, target, user));
      } catch {
        if (!cancelled) setProsody(null);
      } finally {
        void ctx.close().catch(() => { /* 已关闭 */ });
      }
    })();
    return () => { cancelled = true; };
  }, [mode, audioUrl, result, audioUrlResult]);
  // 切模式 / 离开页面时回收录音结果的 Blob URL；此前只有 reset() 会 revoke。
  // setup 里重置 mountedRef：StrictMode 会模拟卸载再挂载且保留 ref，
  // 只在 cleanup 置 false 的话，dev 下重挂载后 current() 永远为 false。
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionRef.current += 1;
      window.clearTimeout(finalizeTimerRef.current);
      onActiveChangeRef.current?.(false);
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    };
  }, []);

  const stopRecognition = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
    recognitionRef.current = null;
  }, []);

  const stopRecording = useCallback(() => {
    if (!recorderRef.current || recorderRef.current.state === 'inactive') return;
    recorderRef.current.stop();
    setRecording(false);
    onActiveChangeRef.current?.(false);
    stopRecognition();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    cancelAnimationFrame(frameRef.current);
    window.clearInterval(timerRef.current);
    closeAudioContext(audioContextRef.current);
    audioContextRef.current = null;
  }, [stopRecognition]);

  useEffect(() => () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state === 'recording') {
      // 组件卸载（切模式 / 离开页面）时不把半成品写进统计：
      // 先摘掉 onstop，再 stop，只释放资源、不触发 finalize → onSave。
      recorder.onstop = null;
      recorder.stop();
    }
    stopRecognition();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    cancelAnimationFrame(frameRef.current);
    window.clearInterval(timerRef.current);
    closeAudioContext(audioContextRef.current);
    audioContextRef.current = null;
  }, [stopRecognition]);

  useEffect(() => {
    // 目标 / 模式变了：作废任何在途的 finalize（含 350ms 定时器与 Whisper 转写），
    // 并回收上一条结果的 Blob URL，避免旧转写写进新目标。
    sessionRef.current += 1;
    window.clearTimeout(finalizeTimerRef.current);
    if (resultUrlRef.current) { URL.revokeObjectURL(resultUrlRef.current); resultUrlRef.current = ''; }
    setAudioUrlResult('');
    setResult(null);
    setTranscript('');
    setManualTranscript('');
    setElapsed(0);
    setSaved(false);
    setError('');
    transcriptRef.current = '';
    finalTranscriptRef.current = '';
    activatedRef.current.clear();
  }, [targetText, mode]);

  useEffect(() => {
    if (recording && maxDuration && elapsed >= maxDuration) stopRecording();
  }, [elapsed, maxDuration, recording, stopRecording]);

  // 模型是模块级缓存：切页面回来不该重新下载
  useEffect(() => {
    if (engine === 'whisper' && !whisper && isWhisperLoaded()) setWhisper({ phase: 'ready', progress: 100, label: '模型已就绪' });
  }, [engine, whisper]);

  const activateWords = (text: string) => {
    if (!onActivateWord) return;
    const spoken = new Set(wordTokens(text));
    challengeWords.forEach((word) => {
      const normalized = word.toLowerCase();
      if (spoken.has(normalized) && !activatedRef.current.has(normalized)) {
        activatedRef.current.add(normalized);
        onActivateWord(normalized);
      }
    });
  };

  const startRecognition = () => {
    if (engineRef.current !== 'native') return;
    const Factory = speechRecognitionFactory();
    if (!Factory) return;
    const recognition = new Factory();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onresult = (event) => {
      let interim = '';
      const confidences: number[] = [];
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const alternative = result[0];
        if (result.isFinal) { finalTranscriptRef.current += ` ${alternative.transcript}`; confidences.push(alternative.confidence || 0.8); }
        else interim += ` ${alternative.transcript}`;
      }
      if (confidences.length) confidenceRef.current = confidences.reduce((sum, value) => sum + value, 0) / confidences.length;
      const full = `${finalTranscriptRef.current} ${interim}`.trim();
      transcriptRef.current = full;
      setTranscript(full);
      activateWords(full);
    };
    // 致命错误（网络 / 权限 / 服务不可用）后不再自动重启，避免 error→end→start 死循环。
    let fatal = false;
    recognition.onerror = (event) => {
      if (event.error === 'aborted' || event.error === 'no-speech') return;
      setError(`实时转写中断：${event.error}。录音仍可保存，并可手动补写转写。`);
      if (event.error === 'network' || event.error === 'not-allowed' || event.error === 'service-not-allowed') fatal = true;
    };
    // Chrome 的 continuous=true 仍会在一段静默后自动 end；不重启的话录音后半程
    // 完全不出字，diff 会把没转写到的词全判「漏读」。只要还在录音就重新拉起。
    recognition.onend = () => {
      if (!fatal && recognitionRef.current === recognition && recorderRef.current?.state === 'recording') {
        try { recognition.start(); } catch { /* 与 stop() 的竞态：忽略 */ }
      }
    };
    recognitionRef.current = recognition;
    try { recognition.start(); } catch { /* browser may already be starting */ }
  };

  const finalize = useCallback(async (blob: Blob, session: number) => {
    // 会话校验：卸载 / 重录 / 切目标之后，旧录音的迟到结果一律丢弃，
    // 不 setState、不落盘、不激活词汇。
    const current = () => mountedRef.current && session === sessionRef.current;
    let text = transcriptRef.current.trim();
    // Whisper 模式：录完再离线转写一遍。比实时识别慢，但准确率和标点都更好，
    // 而且不依赖浏览器是否支持 Web Speech（Safari / Firefox 完全可用）。
    if (engineRef.current === 'whisper') {
      try {
        const heard = await transcribeWithWhisper(blob, modelRef.current, (progress) => { if (current()) setWhisper(progress); });
        if (!current()) return;
        if (heard) { text = heard; transcriptRef.current = heard; setTranscript(heard); activateWords(heard); }
        else setError('Whisper 没有识别到语音内容。可以重录，或手动补写转写。');
      } catch (reason) {
        if (!current()) return;
        setError(`本地模型转写失败：${reason instanceof Error ? reason.message : '未知错误'}。录音已保留，可手动补写转写。`);
        setWhisper({ phase: 'error', progress: 0, label: '转写失败' });
      }
    }
    if (!current()) return;
    const tokens = targetText && text ? diffTranscript(targetText, text, confidenceRef.current) : [];
    const pauseRatio = silenceRef.current.total ? Math.min(1, silenceRef.current.silent / silenceRef.current.total) : 0;
    const metrics = voiceMetrics(targetText, text, tokens, Math.max(1, durationRef.current), pauseRatio);
    const record: VoiceRecord = { id: makeId('voice'), bookId, noteId, mode, targetText, transcript: text, diffTokens: tokens, metrics, createdAt: new Date().toISOString() };
    // 先回收上一条结果的 Blob URL 再创建新的：「再录一次」不再逐轮泄漏录音 Blob。
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    const url = URL.createObjectURL(blob);
    resultUrlRef.current = url;
    setResult(record);
    setManualTranscript(text);
    setAudioUrlResult(url);
    if (text) {
      setSaving(true);
      // 等真正落盘结果再置 saved：写失败时保持「尚未保存」，不再谎报成功。
      const ok = await onSave(record, blob);
      if (current()) { setSaved(ok); setSaving(false); }
    }
  }, [bookId, noteId, mode, onSave, targetText]);

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { setError('当前浏览器不支持录音，请使用最新版 Chrome、Edge 或 Safari。'); return; }
    // getUserMedia 等待期间 recording 还是 false：不加守卫的话双击会拿到两条
    // stream，第一条永远无人 stop，麦克风指示灯常亮。
    if (startingRef.current || recording) return;
    startingRef.current = true;
    setStarting(true);
    const session = ++sessionRef.current;
    const current = () => mountedRef.current && session === sessionRef.current;
    setError('');
    setResult(null);
    setSaved(false);
    setTranscript('');
    if (resultUrlRef.current) { URL.revokeObjectURL(resultUrlRef.current); resultUrlRef.current = ''; }
    setAudioUrlResult('');
    transcriptRef.current = '';
    finalTranscriptRef.current = '';
    confidenceRef.current = 1;
    silenceRef.current = { silent: 0, total: 0 };
    durationRef.current = 0;
    activatedRef.current.clear();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      // 等待授权期间组件可能已卸载 / 用户已切目标：立刻释放刚拿到的麦克风。
      if (!current()) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        // 定时器句柄入 ref：卸载 / 切目标时能取消，不再留下无人认领的 finalize。
        finalizeTimerRef.current = window.setTimeout(() => void finalize(blob, session), 350);
      };
      const context = new AudioContext();
      audioContextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const loop = () => {
        if (canvasRef.current) {
          const energy = drawWave(canvasRef.current, analyser, '#22d3ee');
          silenceRef.current.total += 1;
          if (energy < 0.025) silenceRef.current.silent += 1;
        }
        frameRef.current = requestAnimationFrame(loop);
      };
      loop();
      recorder.start(250);
      setRecording(true);
      onActiveChangeRef.current?.(true);
      const startedAt = Date.now();
      timerRef.current = window.setInterval(() => { const value = (Date.now() - startedAt) / 1000; durationRef.current = value; setElapsed(value); }, 200);
      startRecognition();
    } catch (reason) {
      // 失败路径统一释放已获取的资源：getUserMedia 成功但 AudioContext / recorder.start
      // 抛错时，之前只 setError，麦克风会一直采集。
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
      cancelAnimationFrame(frameRef.current);
      closeAudioContext(audioContextRef.current);
      audioContextRef.current = null;
      setError(reason instanceof DOMException && reason.name === 'NotAllowedError' ? '麦克风权限被拒绝。请在浏览器地址栏允许麦克风后重试。' : '无法启动麦克风，请检查设备与浏览器权限。');
    } finally {
      startingRef.current = false;
      if (mountedRef.current) setStarting(false);
    }
  };

  const saveManual = async () => {
    if (!result || !manualTranscript.trim() || saving) return;
    const session = sessionRef.current;
    const tokens = result.targetText ? diffTranscript(result.targetText, manualTranscript, 1) : [];
    const updated = { ...result, transcript: manualTranscript.trim(), diffTokens: tokens, metrics: voiceMetrics(result.targetText, manualTranscript, tokens, result.metrics.duration, result.metrics.pauseRatio / 100) };
    setResult(updated);
    setSaving(true);
    try {
      const blob = await fetch(audioUrlResult).then((response) => response.blob());
      const ok = await onSave(updated, blob);
      if (mountedRef.current && session === sessionRef.current) { setSaved(ok); if (!ok) setError('录音保存失败，请检查浏览器存储空间后重试。'); }
    } catch {
      if (mountedRef.current && session === sessionRef.current) setError('录音文件读取失败，本次练习未保存。');
    } finally {
      if (mountedRef.current && session === sessionRef.current) setSaving(false);
    }
    activateWords(manualTranscript);
  };

  const reset = () => {
    setResult(null);
    setProsody(null);
    setTranscript('');
    setManualTranscript('');
    setElapsed(0);
    setSaved(false);
    if (audioUrlResult) URL.revokeObjectURL(audioUrlResult);
    setAudioUrlResult('');
  };

  const gaps = result ? intelligibilityGaps(result.diffTokens) : [];
  const speakWords = (text: string) => {
    if (!('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
  };

  const prepareWhisper = async (target: WhisperModelId) => {
    if (!whisperSupported) { setError('当前浏览器不支持本地模型转写（需要 Worker + WebAssembly）。'); return; }
    setError('');
    setWhisper({ phase: 'download', progress: 0, label: '准备本地模型…' });
    try {
      await warmupWhisper(target, setWhisper);
      setWhisper({ phase: 'done', progress: 100, label: '本地模型已就绪' });
    } catch (reason) {
      setWhisper({ phase: 'error', progress: 0, label: '模型下载失败' });
      setError(`本地模型加载失败：${reason instanceof Error ? reason.message : '未知错误'}。可切换回浏览器实时识别。`);
    }
  };

  const switchEngine = (next: SttEngine) => {
    if (next === engine) return;
    setEngine(next);
    setError('');
    if (next === 'whisper' && !isWhisperLoaded()) void prepareWhisper(model);
  };

  const switchModel = (next: WhisperModelId) => {
    if (next === model) return;
    setModel(next);
    if (engine === 'whisper') void prepareWhisper(next);
  };

  const switchSource = (next: WhisperSource) => {
    if (next === source) return;
    setSource(next);
    setWhisperSource(next);
    // 换了源等于换了模型地址，缓存不再复用，重新拉一遍
    if (engine === 'whisper') void prepareWhisper(model);
  };

  return <div className={`voice-recorder ${compact ? 'compact' : ''}`}>
    <div className="stt-bar">
      <div className="stt-switch" role="group" aria-label="转写引擎">
        <button className={engine === 'native' ? 'active' : ''} onClick={() => switchEngine('native')} disabled={!sttAvailable} title={sttAvailable ? '浏览器实时转写，边说边出字' : '此浏览器没有原生语音识别'}>
          <Zap size={13} />实时识别
        </button>
        <button className={engine === 'whisper' ? 'active' : ''} onClick={() => switchEngine('whisper')} disabled={!whisperSupported} title="本地模型，离线可用，标点与准确率更好">
          <Cpu size={13} />本地 Whisper
        </button>
      </div>
      {engine === 'whisper' ? <div className="stt-detail">
        <div className="stt-models">
          {WHISPER_MODELS.map((item) => <button key={item.id} className={`chip ${model === item.id ? 'active' : ''}`} onClick={() => switchModel(item.id)} disabled={recording} title={`${item.note} · ${item.size}`}>{item.name}</button>)}
          <label className="stt-source" title="模型下载源">
            <span>源</span>
            <select value={source} onChange={(event) => switchSource(event.target.value as WhisperSource)} disabled={recording}>
              {(Object.keys(WHISPER_SOURCE_LABEL) as WhisperSource[]).map((key) => <option key={key} value={key}>{WHISPER_SOURCE_LABEL[key]}</option>)}
            </select>
          </label>
        </div>
        <span className={`stt-state ${whisper?.phase || 'idle'}`}>
          {whisper?.phase === 'download' && `下载中 ${whisper.progress}%${whisper.label ? ` · ${whisper.label}` : ''}`}
          {whisper?.phase === 'ready' && '模型已就绪 · 录完自动离线转写'}
          {whisper?.phase === 'transcribing' && '正在识别…'}
          {whisper?.phase === 'error' && <>模型加载失败<button className="stt-load" onClick={() => void prepareWhisper(model)}>重试</button></>}
          {(!whisper || whisper.phase === 'idle') && <>首次启用需下载模型（{WHISPER_MODELS.find((item) => item.id === model)?.size}，一次性）<button className="stt-load" onClick={() => void prepareWhisper(model)}>立即下载</button></>}
        </span>
        {whisper?.phase === 'download' && <div className="stt-progress"><span style={{ width: `${whisper.progress}%` }} /></div>}
      </div> : <span className="stt-hint">{sttAvailable ? 'Chrome / Edge 边说边出字，音频不出本机' : '此浏览器无原生识别，可切到本地 Whisper 或录音后补写'}</span>}
    </div>
    <div className="dual-tracks">
      <ReferenceTrack audioUrl={audioUrl} bookId={bookId} targetText={targetText} />
      <div className={`recording-track ${recording ? 'is-recording' : ''}`}>
        <div className="track-heading"><span><AudioLines size={14} />你的声波</span><small>{recording ? 'LIVE INPUT' : 'MICROPHONE'}</small></div>
        <canvas ref={canvasRef} className="wave-canvas" aria-label="麦克风实时声波" />
        <div className="track-controls"><span className={recording ? 'recording-dot' : ''}>{recording ? '正在聆听你的声音' : '等待开始录音'}</span><strong>{formatDuration(elapsed)}{maxDuration ? ` / ${formatDuration(maxDuration)}` : ''}</strong></div>
      </div>
    </div>
    <div className={`voice-target ${hideTarget && !result ? 'hidden-target' : ''}`}>
      <span className="eyebrow">{hideTarget && !result ? 'TEXT HIDDEN · RETELL FROM MEMORY' : 'TARGET TEXT'}</span>
      <p>{hideTarget && !result ? '原段落已隐藏。用你自己的话说出大意，不必逐字复述。' : (nextFocus?.word && targetText ? highlightWord(targetText, nextFocus.word) : (targetText || '自由表达，没有标准答案。试着让意思完整、句子清楚。'))}</p>
    </div>
    {nextFocus && <div className="focus-reminder"><span className="eyebrow">NEXT ROUND · ONE THING</span><strong>下一轮只盯：{nextFocus.title}</strong><span>{nextFocus.advice}</span></div>}
    {(recording || transcript || whisper?.phase === 'transcribing') && <div className="live-transcript"><span>{engine === 'native' ? 'REAL-TIME TRANSCRIPT' : 'WHISPER TRANSCRIPT'}</span><p>{transcript || (engine === 'native' ? '正在等待语音识别…' : '录音已结束，本地模型正在转写…')}</p></div>}
    {error && <div className="voice-error">{error}</div>}
    <div className="record-actions">
      {!recording ? <Button size="lg" onClick={() => void startRecording()} disabled={starting || (mode !== 'freetalk' && !targetText)}><Mic size={19} />{starting ? '正在启动麦克风…' : result ? '再录一次' : '开始录音'}</Button> : <Button size="lg" variant="secondary" onClick={stopRecording}><Square size={17} />完成录音</Button>}
      {engine === 'native' && !sttAvailable && <span>此浏览器无原生 STT；可切到本地 Whisper，或录音后手动输入转写。</span>}
      {engine === 'native' && sttAvailable && !recording && !result && <span>Chrome / Edge 可实时转写；音频只保存在本机。</span>}
      {engine === 'whisper' && !recording && !result && <span>录完自动离线转写；模型与音频都留在本机。</span>}
    </div>
    {result && <div className="voice-result page-enter">
      <div className="metric-grid"><div><span>有效语速</span><strong>{result.metrics.wpm}<small>WPM</small></strong></div><div><span>卡顿占比</span><strong>{result.metrics.pauseRatio}<small>%</small></strong></div><div><span>{mode === 'freetalk' ? '开口词数' : '词级匹配'}</span><strong>{mode === 'freetalk' ? result.metrics.wordCount : result.metrics.accuracy}<small>{mode === 'freetalk' ? '词' : '%'}</small></strong></div><div><span>口头禅</span><strong>{result.metrics.fillerCount}<small>次</small></strong></div></div>
      {!showDiag && <div className="self-monitor"><span className="eyebrow">SELF-MONITOR · 先自评</span><strong>你觉得自己哪里没跟上？</strong><p>先凭感觉选一个，再展开系统对比——自我监控是发音习得的关键闭环。</p><div className="self-options">{SELF_OPTIONS.map((o) => <button key={o.key} className="chip" onClick={() => setSelfReport(o.key)}>{o.label}</button>)}</div><button className="self-skip" onClick={() => setSelfSkipped(true)}>跳过自评，直接看对比</button></div>}
      {showDiag && selfReport && <div className="self-compare">{selfCompareText(selfReport, focus)}</div>}
      {showDiag && <>
      {focus && <div className="focus-card"><span className="eyebrow">ONE THING AT A TIME</span><strong>{focus.title}</strong><p>{focus.advice}</p><div className="panel-actions"><Button size="sm" onClick={() => setNextFocus(focus)}>下一轮只练这个</Button>{focus.word && <Button size="sm" variant="secondary" onClick={() => speakWords(focus.word!)}><Volume2 size={15} />听这个词</Button>}</div></div>}
      {result.diffTokens.length > 0 && <div className="diff-panel"><div className="diff-legend"><span><i className="green" />匹配</span><span><i className="yellow" />低置信度</span><span><i className="red" />漏读 / 替换</span></div><div className="diff-tokens">{result.diffTokens.map((token, index) => <button key={`${token.text}-${index}`} className={`diff-${token.status}`} title={token.spoken ? `识别为：${token.spoken}` : '这个词没有被识别到'} onClick={() => { if (!('speechSynthesis' in window)) return; const utterance = new SpeechSynthesisUtterance(token.text); utterance.lang = 'en-US'; window.speechSynthesis.speak(utterance); }}>{token.text}</button>)}</div><p>点击词可听标准音。词级 Diff 来自 STT 对齐，不等同于音素评分。</p></div>}
      {gaps.length > 0 && <div className="intelligibility-panel"><div className="panel-head"><span className="eyebrow">INTELLIGIBILITY</span><strong>有 {gaps.length} 个词可能没被听懂</strong></div><ul className="intelligibility-list">{gaps.map((gap, index) => <li key={`${gap.word}-${index}`}><button className="gap-word" onClick={() => speakWords(gap.word)} title="听标准音">{gap.word}</button><span className="gap-note">{gap.kind === 'substitute' ? `识别成了 “${gap.spoken}”` : '未识别到'}</span></li>)}</ul><div className="panel-actions"><Button size="sm" variant="secondary" onClick={() => speakWords(gaps.map((g) => g.word).join(', '))}><Volume2 size={15} />听标准音</Button><span className="panel-hint">重录时重点读这些词。这是「机器可能没听清」，不是「你读错了」。</span></div></div>}
      {prosody && prosody.length > 0 && <div className="prosody-panel"><div className="panel-head"><span className="eyebrow">PROSODY · 节奏对比</span><strong>重音与拖长</strong></div><div className="prosody-row"><span className="prosody-label">TARGET</span><div className="prosody-words">{prosody.map((p, i) => <span key={`t-${p.word}-${i}`} className="prosody-word target">{p.word}</span>)}</div></div><div className="prosody-row"><span className="prosody-label">YOURS</span><div className="prosody-words">{prosody.map((p, i) => <span key={`u-${p.word}-${i}`} className={`prosody-word ${p.status}`} title={p.status === 'weak' ? '该重读却弱读' : p.status === 'long' ? '该弱读却拖长' : '节奏匹配'}>{p.word}</span>)}</div></div><div className="diff-legend"><span><i className="green" />节奏匹配</span><span><i className="yellow" />弱读拖长</span><span><i className="red" />重音缺失</span></div><p>节奏相似度，不等同于发音正确度。</p></div>}
      {complexity && <div className="complexity-panel">
        <div className="panel-head"><span className="eyebrow">COMPLEXITY · 复杂度</span><span className={`complexity-level ${complexity.level}`}>{complexity.level === 'rich' ? '丰富' : complexity.level === 'developing' ? '发展中' : '简单'}</span></div>
        <div className="complexity-grid">
          <div><strong>{complexity.avgSentenceLen.toFixed(1)}</strong><span>平均句长(词)</span></div>
          <div><strong>{complexity.clausePerSentence.toFixed(2)}</strong><span>从句/句</span></div>
          <div><strong>{Math.round(complexity.ttr * 100)}%</strong><span>词汇多样性</span></div>
        </div>
        <p className="complexity-next">{complexitySuggestion(complexity)}</p>
        <p className="complexity-note">{COMPLEXITY_NOTE}</p>
      </div>}
      </>}
      {result.transcript && <div className="final-transcript"><span>YOUR TRANSCRIPT</span><p>{result.transcript}</p></div>}
      {!result.transcript && <div className="manual-transcript"><label>录音已完成。补入你实际说出的内容，再生成诊断：</label><textarea value={manualTranscript} onChange={(event) => setManualTranscript(event.target.value)} rows={3} placeholder="Type what you actually said…" /><Button disabled={!manualTranscript.trim() || saving} onClick={() => void saveManual()}>{saving ? '正在保存…' : '保存转写与诊断'}</Button></div>}
      {audioUrlResult && <audio className="result-audio" src={audioUrlResult} controls />}
      <div className="result-footer"><span className={saved ? 'saved-indicator' : ''}>{saved ? <><Check size={15} />练习与录音已保存</> : saving ? '正在保存…' : '尚未保存'}</span><button onClick={reset}><RotateCcw size={14} />清空本次结果</button></div>
    </div>}
  </div>;
}
