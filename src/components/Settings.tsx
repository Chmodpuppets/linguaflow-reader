import { useRef } from 'react';
import { BookOpen, Check, Database, Download, HardDrive, Minus, Plus, ShieldCheck, Upload } from 'lucide-react';
import type { AppData, Book, ReaderSettings } from '../types';
import AudioBinding from './AudioBinding';
import StorageUsage from './StorageUsage';
import OrphanAudioCleanup from './OrphanAudioCleanup';
import { Button, Toggle } from './UI';

export default function Settings({ settings, data, books, storageReady, onSettings, onExport, onImport, onNotify }: { settings: ReaderSettings; data: AppData; books: Book[]; storageReady: boolean; onSettings: (settings: Partial<ReaderSettings>) => void; onExport: () => void; onImport: (data: AppData) => void; onNotify?: (message: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const importBackup = async (file?: File) => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { onNotify?.('备份文件超过 20MB，请确认是本应用导出的 JSON。'); return; }
    try {
      const parsed = JSON.parse(await file.text()) as AppData;
      const raw = parsed as unknown as Record<string, unknown>;
      const lists = ['books', 'vocabulary', 'highlights', 'reviewLogs', 'voiceRecords'];
      if (lists.some((key) => !Array.isArray(raw[key]))) throw new Error('缺少必要的数据列表');
      const settings = raw.settings as Record<string, unknown> | undefined;
      if (!settings || typeof settings.fontSize !== 'number' || typeof settings.lineHeight !== 'number') throw new Error('阅读版式设置不完整');
      if (!['midnight', 'sepia', 'paper'].includes(String(settings.theme))) throw new Error('主题设置无法识别');
      onImport(parsed);
      onNotify?.(`已恢复 ${(raw.books as unknown[]).length} 本书 · ${(raw.vocabulary as unknown[]).length} 个词 · ${(raw.highlights as unknown[]).length} 条标记`);
    } catch (error) {
      onNotify?.(`备份恢复失败：${error instanceof Error ? error.message : '文件格式不正确'}`);
    }
  };
  return <div className="page settings-page page-enter"><div className="page-heading"><div><span className="eyebrow">MAKE IT YOURS</span><h1>你的阅读环境，由你决定。</h1><p>版式、主题和数据，都应该服务于真实的阅读习惯。</p></div></div><div className="settings-layout"><section className="settings-card glass-panel"><div className="settings-card-head"><BookOpen size={20} /><div><h2>阅读版式</h2><p>更改会立即应用到所有书籍。</p></div></div><div className="reader-preview"><span>THE ART OF NOTICING</span><p style={{ fontSize: `${settings.fontSize}px`, lineHeight: settings.lineHeight }}>Attention is a quiet form of generosity. What we choose to notice becomes part of the life we remember.</p></div><div className="setting-row"><div><strong>正文字号</strong><span>16–26 px</span></div><div className="stepper"><button onClick={() => onSettings({ fontSize: Math.max(16, settings.fontSize - 1) })}><Minus size={15} /></button><strong>{settings.fontSize}</strong><button onClick={() => onSettings({ fontSize: Math.min(26, settings.fontSize + 1) })}><Plus size={15} /></button></div></div><div className="setting-row"><div><strong>正文行距</strong><span>给眼睛留出呼吸空间</span></div><div className="stepper"><button onClick={() => onSettings({ lineHeight: Math.max(1.5, Number((settings.lineHeight - 0.1).toFixed(1))) })}><Minus size={15} /></button><strong>{settings.lineHeight.toFixed(1)}</strong><button onClick={() => onSettings({ lineHeight: Math.min(2.1, Number((settings.lineHeight + 0.1).toFixed(1))) })}><Plus size={15} /></button></div></div><div className="setting-row stacked"><div><strong>阅读纸面</strong><span>应用外壳保留 LinguaFlow 深色品牌风格</span></div><div className="theme-options">{(['midnight', 'sepia', 'paper'] as const).map((theme) => <button key={theme} className={`${theme} ${settings.theme === theme ? 'active' : ''}`} onClick={() => onSettings({ theme })}><span>Aa</span><small>{theme === 'midnight' ? '暗夜' : theme === 'sepia' ? '羊皮纸' : '白纸'}</small>{settings.theme === theme && <Check size={13} />}</button>)}</div></div><div className="setting-row"><div><strong>降低环境光效</strong><span>阅读时让背景更安静</span></div><Toggle checked={settings.reducedAmbient} onChange={(checked) => onSettings({ reducedAmbient: checked })} label="降低环境光效" /></div></section>
    <div className="settings-side"><section className="settings-card glass-panel"><div className="settings-card-head"><Database size={20} /><div><h2>本地工作区</h2><p>你的内容不需要先交给云端。</p></div></div><div className="storage-status"><span className={storageReady ? 'online' : ''} /><div><strong>{storageReady ? 'IndexedDB 已连接' : '正在连接本地存储'}</strong><p>{data.books.length} 本书 · {data.vocabulary.length} 个词 · {data.highlights.length} 条标记 · {data.voiceRecords.length} 次口语练习</p></div></div><StorageUsage /><OrphanAudioCleanup records={data.voiceRecords} onNotify={onNotify} /><div className="storage-features"><span><HardDrive size={15} />书籍与笔记离线可用</span><span><ShieldCheck size={15} />不上传 EPUB 或阅读记录</span><span><HardDrive size={15} />录音独立存储，JSON 备份不含音频文件</span></div><div className="backup-buttons"><Button variant="secondary" onClick={onExport}><Download size={16} />导出备份</Button><Button variant="ghost" onClick={() => fileRef.current?.click()}><Upload size={16} />恢复备份</Button><input ref={fileRef} hidden type="file" accept=".json,application/json" onChange={(event) => void importBackup(event.target.files?.[0])} /></div></section><AudioBinding books={books} onNotify={onNotify} /><section className="settings-card glass-panel about-card"><img src="/linguaflow-icon.png" alt="" /><span className="eyebrow">LINGUAFLOW READER</span><h2>Read. Notice. Remember.</h2><p>Version 0.1.0 · Local-first PWA</p><small>阅读不是收集更多内容，而是让一些内容真正进入自己。</small></section></div></div></div>;
}
