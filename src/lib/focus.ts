// Voice Lab v2 · Tier 2 ③：焦点式纠错（one thing at a time）。
// 注意假说 + 认知负荷：一次只纠一个点。从「漏读 / 重音 / 拖长 / 停顿 / 口头禅 / 替换」
// 里按优先级自动选出本轮唯一焦点，下一轮只盯它。纯前端排序，不新增模型。

import type { DiffToken } from '../types';
import type { ProsodyWord } from './prosody';

export type FocusKind = 'missing' | 'weak' | 'long' | 'pause' | 'filler' | 'substitute';

export interface FocusPoint {
  kind: FocusKind;
  word?: string;
  title: string;
  advice: string;
}

export interface FocusInput {
  tokens: DiffToken[];
  prosody?: ProsodyWord[] | null;
  pauseRatioPct?: number;
  fillerCount?: number;
}

export function pickFocus(input: FocusInput): FocusPoint | null {
  const { tokens, prosody, pauseRatioPct = 0, fillerCount = 0 } = input;

  const missing = tokens.find((t) => t.status === 'missing');
  if (missing) {
    return { kind: 'missing', word: missing.text, title: `你的 “${missing.text}” 没有被读到`, advice: '下一轮：把这个词完整说出口，别吞掉。' };
  }

  const weak = prosody?.find((p) => p.status === 'weak');
  if (weak) {
    return { kind: 'weak', word: weak.word, title: `你的 “${weak.word}” 重音弱了`, advice: '下一轮：说重一点、拉长一点。' };
  }

  const long = prosody?.find((p) => p.status === 'long');
  if (long) {
    return { kind: 'long', word: long.word, title: `你的 “${long.word}” 拖长了`, advice: '下一轮：轻一点、短一点，把重音让给该重的词。' };
  }

  if (pauseRatioPct > 35) {
    return { kind: 'pause', title: `停顿偏多（${Math.round(pauseRatioPct)}%）`, advice: '下一轮：先慢速连读，减少词与词之间的断点。' };
  }

  if (fillerCount > 0) {
    return { kind: 'filler', title: `口头禅 ${fillerCount} 次`, advice: '下一轮：想不起词时停半秒，代替 um / uh。' };
  }

  const sub = tokens.find((t) => t.status === 'substitute');
  if (sub) {
    return { kind: 'substitute', word: sub.text, title: `你的 “${sub.text}” 被听成了 “${sub.spoken || '?'}”`, advice: '下一轮：把词尾说清楚。' };
  }

  return null;
}
