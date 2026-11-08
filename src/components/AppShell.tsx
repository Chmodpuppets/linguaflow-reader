import { useState, type ReactNode } from 'react';
import { BookOpen, Brain, ChartNoAxesCombined, ChevronLeft, ChevronRight, Highlighter, Library, Menu, Mic2, Settings, Wifi, WifiOff } from 'lucide-react';
import type { Page } from '../types';

const navItems: { id: Page; label: string; en: string; icon: typeof Library }[] = [
  { id: 'library', label: '我的书库', en: 'Library', icon: Library },
  { id: 'vocabulary', label: '词汇笔记本', en: 'Vocabulary', icon: BookOpen },
  { id: 'review', label: '主动复习', en: 'Review', icon: Brain },
  { id: 'voice-lab', label: '口语实验室', en: 'Voice Lab', icon: Mic2 },
  { id: 'voice-analytics', label: '声波与成长统计', en: 'Voice Analytics', icon: ChartNoAxesCombined },
  { id: 'notes', label: '标记与笔记', en: 'Notes', icon: Highlighter },
  { id: 'settings', label: '阅读设置', en: 'Settings', icon: Settings },
];

export default function AppShell({ page, onNavigate, children, vocabCount, dueCount, online }: { page: Page; onNavigate: (page: Page) => void; children: ReactNode; vocabCount: number; dueCount: number; online: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = (target: Page) => { onNavigate(target); setMobileOpen(false); };
  return <div className="app-shell">
    <div className={`ambient-bg ${page === 'library' ? '' : 'quiet'}`} aria-hidden="true"><div className="aurora aurora-a" /><div className="aurora aurora-b" /><div className="grid-overlay" /></div>
    <header className="mobile-header glass-panel"><img src="/linguaflow-icon.png" alt="" /><div><strong>LinguaFlow</strong><span>Reader</span></div><button className="icon-button" onClick={() => setMobileOpen(true)} aria-label="打开导航"><Menu size={21} /></button></header>
    {mobileOpen && <button className="drawer-backdrop" onClick={() => setMobileOpen(false)} aria-label="关闭导航" />}
    <aside className={`sidebar glass-panel ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="brand"><img src={collapsed ? '/linguaflow-icon.png' : '/linguaflow-logo.png'} alt="LinguaFlow" /><span className="reader-badge">READER</span></div>
      <div className="workspace-label">{!collapsed && <><span>PERSONAL WORKSPACE</span><strong>Read. Notice. Remember.</strong></>}</div>
      <nav className="main-nav" aria-label="主导航">{navItems.map((item) => { const Icon = item.icon; return <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)} title={collapsed ? item.label : undefined}><Icon size={19} /><span className="nav-copy"><strong>{item.label}</strong><small>{item.en}</small></span>{item.id === 'vocabulary' && vocabCount > 0 && <span className="nav-count">{vocabCount}</span>}{item.id === 'review' && dueCount > 0 && <span className="nav-count accent">{dueCount}</span>}</button>; })}</nav>
      <div className="sidebar-spacer" />
      <div className="local-card"><div className="local-icon">{online ? <Wifi size={17} /> : <WifiOff size={17} />}</div>{!collapsed && <div><strong>{online ? '本地工作区已就绪' : '当前处于离线模式'}</strong><span>你的数据只保存在这台设备</span></div>}</div>
      <button className="collapse-button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? '展开侧栏' : '折叠侧栏'}>{collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</button>
    </aside>
    <main className={`main-area ${collapsed ? 'sidebar-collapsed' : ''}`}><div className="main-scroll">{children}</div></main>
    <nav className="mobile-tabs glass-panel" aria-label="移动导航">{navItems.slice(0, 4).map((item) => { const Icon = item.icon; return <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><Icon size={20} /><span>{item.en}</span></button>; })}<button className={page === 'settings' ? 'active' : ''} onClick={() => navigate('settings')}><Settings size={20} /><span>Settings</span></button></nav>
  </div>;
}
