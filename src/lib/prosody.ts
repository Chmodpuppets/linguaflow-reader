import type { DiffToken } from '../types';

/**
 * 韵律反馈（prosody shadowing）· Voice Lab v2 Tier 1 ①
 *
 * 诚实边界：输出是「节奏/重音相似度」，不是「发音正确度」。
 * 不依赖音素模型、不需要后端：Web Audio 解码原音与录音 → 逐词能量包络 + 浊音占比对齐。
 * 逐词边界用「浊音区间等分」（无 Whisper word timestamps 时的稳妥近似）。
 */

export interface WordFeature {
  /** 该词窗口的归一化前能量（RMS）。 */
  energy: number;
  /** 该词窗口内浊音帧占比（0–1），近似「拖长/ sustain」。 */
  voiced: number;
}

export type ProsodyStatus = 'match' | 'weak' | 'long';

export interface ProsodyWord {
  word: string;
  status: ProsodyStatus;
}

/** 可被 decode 的最小 AudioBuffer 形状（便于 node 单测注入替身）。 */
export interface AudioBufferLike {
  duration: number;
  sampleRate: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

const FRAME_SECONDS = 0.02;

/** 把一段音频按词数等分，提取每词的能量与浊音占比。先裁掉首尾静音。 */
export function wordFeaturesFromBuffer(buffer: AudioBufferLike, wordCount: number): WordFeature[] {
  if (wordCount <= 0) return [];
  const data = buffer.getChannelData(0);
  const frameSize = Math.max(1, Math.round(buffer.sampleRate * FRAME_SECONDS));
  const frameCount = Math.floor(data.length / frameSize);
  if (frameCount === 0) return Array.from({ length: wordCount }, () => ({ energy: 0, voiced: 0 }));
  const rms = new Array<number>(frameCount);
  let maxRms = 0;
  for (let f = 0; f < frameCount; f += 1) {
    let sum = 0;
    const start = f * frameSize;
    for (let i = start; i < start + frameSize; i += 1) sum += data[i] * data[i];
    rms[f] = Math.sqrt(sum / frameSize);
    if (rms[f] > maxRms) maxRms = rms[f];
  }
  const threshold = Math.max(0.008, maxRms * 0.15);
  let first = 0;
  let last = frameCount - 1;
  while (first < last && rms[first] < threshold) first += 1;
  while (last > first && rms[last] < threshold) last -= 1;
  const span = last - first + 1;
  const features: WordFeature[] = [];
  for (let w = 0; w < wordCount; w += 1) {
    const from = first + Math.floor((span * w) / wordCount);
    const to = first + Math.floor((span * (w + 1)) / wordCount);
    let energy = 0;
    let voicedFrames = 0;
    let n = 0;
    for (let f = from; f < to; f += 1) {
      energy += rms[f] * rms[f];
      if (rms[f] >= threshold) voicedFrames += 1;
      n += 1;
    }
    features.push({ energy: n ? Math.sqrt(energy / n) : 0, voiced: n ? voicedFrames / n : 0 });
  }
  return features;
}

function normalizeEnergy(features: WordFeature[]): number[] {
  const max = features.reduce((m, f) => Math.max(m, f.energy), 0);
  return features.map((f) => (max > 0 ? f.energy / max : 0));
}

/**
 * 对齐原音与录音的逐词节奏：
 *  🔴 weak  原音该重读（相对能量高）你却弱读；
 *  🟡 long  原音该弱读你却拖长（浊音占比高）；
 *  🟢 match 其余视为节奏匹配。
 */
export function classifyProsody(words: string[], target: WordFeature[], user: WordFeature[]): ProsodyWord[] {
  const te = normalizeEnergy(target);
  const ue = normalizeEnergy(user);
  return words.map((word, i) => {
    const t = te[i] ?? 0;
    const u = ue[i] ?? 0;
    const uv = user[i]?.voiced ?? 0;
    let status: ProsodyStatus = 'match';
    if (t >= 0.6 && u < 0.45) status = 'weak';
    else if (t < 0.5 && uv > 0.9 && u >= 0.45) status = 'long';
    return { word, status };
  });
}

/** 可懂度信号（Tier 1 ②·简单档）：复用 diff 的 substitute/missing，呈现「可能没被听懂」。 */
export interface IntelligibilityItem {
  word: string;
  spoken?: string;
  kind: 'substitute' | 'missing';
}

export function intelligibilityGaps(tokens: DiffToken[]): IntelligibilityItem[] {
  return tokens
    .filter((t) => t.status === 'substitute' || t.status === 'missing')
    .map((t) => ({ word: t.text, spoken: t.spoken, kind: t.status as 'substitute' | 'missing' }));
}
