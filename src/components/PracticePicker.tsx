import { useEffect, useState } from 'react';
import { Search, Volume2 } from 'lucide-react';
import type { PracticeTarget, TargetGroup } from '../lib/practiceTargets';
import { metaFor, wordCount, type PracticeMeta } from '../lib/practiceMeta';

const TABS: { group: TargetGroup; label: string }[] = [
  { group: 'sentence', label: '我的收藏句' },
  { group: 'highlight', label: '我的标记' },
  { group: 'paragraph', label: '书中段落' },
];

/**
 * 练习目标选择器（方向 A：收藏句卡片轨 + 方向 C：默认到期句）。
 * 用「你的收藏句」卡片轨取代原生下拉：完整句子、来源、词数、试听、练习历史/到期徽章，
 * 三段 Tab（收藏句/标记/书中段落）+ 搜索。点卡即设为当前练习句。
 */
export default function PracticePicker({ targets, customTarget, selectedId, metaMap, onSelect }: {
  targets: PracticeTarget[];
  customTarget: PracticeTarget | null;
  selectedId?: string;
  metaMap: Map<string, PracticeMeta>;
  onSelect: (id: string) => void;
}) {
  const allTargets = customTarget ? [customTarget, ...targets] : targets;
  const [activeTab, setActiveTab] = useState<TargetGroup>('sentence');
  const [query, setQuery] = useState('');

  const itemsOf = (group: TargetGroup) => allTargets.filter((target) => target.group === group);

  // 当前 Tab 空了（如收藏句被删光）自动落到第一个有内容的分组。
  useEffect(() => {
    if (itemsOf(activeTab).length > 0) return;
    const first = TABS.find((tab) => itemsOf(tab.group).length > 0);
    if (first) setActiveTab(first.group);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets, customTarget]);

  useEffect(() => () => { window.speechSynthesis?.cancel(); }, []);

  const speak = (text: string) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  };

  if (allTargets.length === 0) {
    return <p className="practice-empty-hint">还没有收藏句或标记。先在阅读页轻点单词「收藏句子」、或划选做标记；也可以导入一本书，书中段落会作为兜底参考出现在这里。</p>;
  }

  const q = query.trim().toLowerCase();
  const activeItems = itemsOf(activeTab);
  const filtered = q ? activeItems.filter((target) => target.text.toLowerCase().includes(q) || target.source.toLowerCase().includes(q)) : activeItems;

  return <div className="practice-picker">
    <div className="practice-tabs" role="tablist" aria-label="练习句来源">
      {TABS.map((tab) => {
        const count = itemsOf(tab.group).length;
        return <button key={tab.group} type="button" role="tab" aria-selected={activeTab === tab.group} className={`practice-tab${activeTab === tab.group ? ' active' : ''}`} onClick={() => setActiveTab(tab.group)}>{tab.label}<span className="practice-tab-count">{count}</span></button>;
      })}
    </div>
    <div className="practice-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索句子或来源…" aria-label="搜索练习句" /></div>
    {filtered.length === 0
      ? <p className="practice-rail-empty">{q ? `没有匹配「${query.trim()}」的句子。` : '这个分组还没有内容。'}</p>
      : <div className="practice-rail">
        {filtered.map((target) => {
          const meta = metaFor(target.text, metaMap);
          const selected = target.id === selectedId;
          return <div key={target.id} className={`practice-card${selected ? ' selected' : ''}${meta.due ? ' due' : ''}`} role="button" tabIndex={0} aria-pressed={selected}
            onClick={() => onSelect(target.id)}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(target.id); } }}>
            <div className="practice-card-top">
              <span className="practice-source" title={target.source}>{target.source}</span>
              {meta.due && <span className="due-badge">到期待重录</span>}
            </div>
            <p className="practice-text" title={target.text}>{target.text}</p>
            <div className="practice-card-foot">
              <span className="practice-words">{wordCount(target.text)} 词</span>
              {meta.count > 0 && <span className="practice-history">练 {meta.count} 次{meta.lastAccuracy != null ? ` · ${meta.lastAccuracy}%` : ''}</span>}
              <button type="button" className="practice-listen" aria-label={`试听：${target.text.slice(0, 30)}`} onClick={(event) => { event.stopPropagation(); speak(target.text); }}><Volume2 size={13} />试听</button>
            </div>
          </div>;
        })}
      </div>}
  </div>;
}
