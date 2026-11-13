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

// ④ 自我监控：先自评再展开对比。自评选项 → 系统焦点 kind 的映射，用于「自评 vs 系统」一致性提示。
export const SELF_OPTIONS: { key: string; label: string; kinds: FocusKind[] }[] = [
  { key: 'missing', label: '漏了词', kinds: ['missing', 'substitute'] },
  { key: 'rhythm', label: '重音/节奏不对', kinds: ['weak', 'long'] },
  { key: 'pause', label: '停顿太多', kinds: ['pause'] },
  { key: 'filler', label: '口头禅多', kinds: ['filler'] },
  { key: 'smooth', label: '挺顺的', kinds: [] },
];

export function selfCompareText(selfKey: string, focus: FocusPoint | null): string {
  const opt = SELF_OPTIONS.find((o) => o.key === selfKey);
  if (!opt) return '';
  if (opt.key === 'smooth') return focus ? `你自评「挺顺的」，但系统发现：${focus.title}。看看下面指出的点。` : '你自评「挺顺的」，系统也没发现明显问题。保持！';
  const match = focus !== null && opt.kinds.includes(focus.kind);
  return `你的自评：${opt.label} ｜ 系统焦点：${focus ? focus.title : '无明显问题'}${match ? '（一致 👍）' : '（不一致，对照下面的诊断看看）'}`;
}
