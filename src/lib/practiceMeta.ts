import type { VoiceRecord } from '../types';
import { groupShadowings, dueShadowings } from './spacedShadowing';
import type { PracticeTarget } from './practiceTargets';

const norm = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');

/** 单个练习目标的历史徽章数据。 */
export interface PracticeMeta {
  /** 跟读练过几次。 */
  count: number;
  /** 最近一次跟读准确率（没练过为 null）。 */
  lastAccuracy: number | null;
  /** 间隔重录是否到期（1/3/7 天）。 */
  due: boolean;
}

const EMPTY: PracticeMeta = { count: 0, lastAccuracy: null, due: false };

/** 按归一化文本聚合跟读历史 + 到期标记，供卡片徽章使用。纯函数，便于单测。 */
export function practiceMetaMap(records: VoiceRecord[], now: number): Map<string, PracticeMeta> {
  const groups = groupShadowings(records);
  const dueKeys = new Set(dueShadowings(groups, now).map((entry) => entry.group.key));
  const map = new Map<string, PracticeMeta>();
  for (const group of groups) {
    map.set(group.key, { count: group.count, lastAccuracy: group.latestAccuracy, due: dueKeys.has(group.key) });
  }
  return map;
}

export function metaFor(text: string, map: Map<string, PracticeMeta>): PracticeMeta {
  return map.get(norm(text)) || EMPTY;
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * 默认练习目标（方向 C 的默认逻辑）：
 * 到期间隔句优先 → 否则第一句收藏句 → 否则列表第一个。
 * 让用户一进来就是「该练的那句」，而不是机械的列表第一条。
 */
export function defaultTarget(targets: PracticeTarget[], map: Map<string, PracticeMeta>): PracticeTarget | undefined {
  const due = targets.find((target) => metaFor(target.text, map).due);
  if (due) return due;
  return targets.find((target) => target.group === 'sentence') || targets[0];
}
