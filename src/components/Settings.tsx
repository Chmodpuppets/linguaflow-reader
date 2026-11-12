import { useRef, useState } from 'react';
import { BookOpen, Check, CloudUpload, Database, Download, HardDrive, LogIn, Minus, Plus, RefreshCw, ShieldCheck, Upload } from 'lucide-react';
import { clearSyncToken, connectAccount, flushQueue, getSyncToken, isSyncEnabled, pendingCount, setSyncEnabled } from '../lib/learning';
import type { AppData, Book, ReaderSettings } from '../types';
import type { StorageChannel } from '../lib/db';
import { findOrphanVoiceAudioIds } from '../lib/db';
import { validateBackup } from '../lib/backup';
import AudioBinding from './AudioBinding';
import StorageUsage from './StorageUsage';
import OrphanAudioCleanup from './OrphanAudioCleanup';
import { Button, Toggle } from './UI';

export default function Settings({ settings, data, books, storageChannel, onSettings, onExport, onImport, onNotify }: { settings: ReaderSettings; data: AppData; books: Book[]; storageChannel: StorageChannel; onSettings: (settings: Partial<ReaderSettings>) => void; onExport: () => void; onImport: (data: AppData) => void; onNotify?: (message: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const importBackup = async (file?: File) => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { onNotify?.('备份文件超过 20MB，请确认是本应用导出的 JSON。'); return; }
    try {
      const parsed = validateBackup(JSON.parse(await file.text()));
      onImport(parsed);
      // 恢复后提示孤儿录音数量，但绝不自动删除（会误删本机新录、还没进备份的音）；
      // 实际清理仍由下方 OrphanAudioCleanup 手动确认。存储不可用时静默忽略。
      let orphanNote = '';
      try {
        const orphans = await findOrphanVoiceAudioIds(parsed.voiceRecords);
        if (orphans.length) orphanNote = ` · 另发现 ${orphans.length} 个孤立录音，可在下方清理`;
      } catch { /* ignore */ }
      onNotify?.(`已恢复 ${parsed.books.length} 本书 · ${parsed.vocabulary.length} 个词 · ${parsed.highlights.length} 条标记${orphanNote}`);
    } catch (error) {
      onNotify?.(`备份恢复失败：${error instanceof Error ? error.message : '文件格式不正确'}`);
    }
    // 允许连续选择同一个文件重试
    if (fileRef.current) fileRef.current.value = '';
  };
  return <div className="page settings-page page-enter"><div className="page-heading"><div><span className="eyebrow">MAKE IT YOURS</span><h1>你的阅读环境，由你决定。</h1><p>版式、主题和数据，都应该服务于真实的阅读习惯。</p></div></div><div className="settings-layout"><section className="settings-card glass-panel"><div className="settings-card-head"><BookOpen size={20} /><div><h2>阅读版式</h2><p>更改会立即应用到所有书籍。</p></div></div><div className="reader-preview"><span>THE ART OF NOTICING</span><p style={{ fontSize: `${settings.fontSize}px`, lineHeight: settings.lineHeight }}>Attention is a quiet form of generosity. What we choose to notice becomes part of the life we remember.</p></div><div className="setting-row"><div><strong>正文字号</strong><span>16–26 px</span></div><div className="stepper"><button onClick={() => onSettings({ fontSize: Math.max(16, settings.fontSize - 1) })}><Minus size={15} /></button><strong>{settings.fontSize}</strong><button onClick={() => onSettings({ fontSize: Math.min(26, settings.fontSize + 1) })}><Plus size={15} /></button></div></div><div className="setting-row"><div><strong>正文行距</strong><span>给眼睛留出呼吸空间</span></div><div className="stepper"><button onClick={() => onSettings({ lineHeight: Math.max(1.5, Number((settings.lineHeight - 0.1).toFixed(1))) })}><Minus size={15} /></button><strong>{settings.lineHeight.toFixed(1)}</strong><button onClick={() => onSettings({ lineHeight: Math.min(2.1, Number((settings.lineHeight + 0.1).toFixed(1))) })}><Plus size={15} /></button></div></div><div className="setting-row stacked"><div><strong>阅读纸面</strong><span>应用外壳保留 LinguaFlow 深色品牌风格</span></div><div className="theme-options">{(['midnight', 'sepia', 'paper'] as const).map((theme) => <button key={theme} className={`${theme} ${settings.theme === theme ? 'active' : ''}`} onClick={() => onSettings({ theme })}><span>Aa</span><small>{theme === 'midnight' ? '暗夜' : theme === 'sepia' ? '羊皮纸' : '白纸'}</small>{settings.theme === theme && <Check size={13} />}</button>)}</div></div><div className="setting-row"><div><strong>降低环境光效</strong><span>阅读时让背景更安静</span></div><Toggle checked={settings.reducedAmbient} onChange={(checked) => onSettings({ reducedAmbient: checked })} label="降低环境光效" /></div></section>
    <div className="settings-side"><section className="settings-card glass-panel"><div className="settings-card-head"><Database size={20} /><div><h2>本地工作区</h2><p>你的内容不需要先交给云端。</p></div></div><div className="storage-status"><span className={storageChannel === 'indexeddb' ? 'online' : ''} /><div><strong>{storageChannel === 'indexeddb' ? 'IndexedDB 已连接' : storageChannel === 'localstorage' ? '已降级到 localStorage' : '本地存储不可用'}</strong><p>{storageChannel === 'none' ? '数据可能无法持久保存，请检查浏览器存储设置 · ' : ''}{data.books.length} 本书 · {data.vocabulary.length} 个词 · {data.highlights.length} 条标记 · {data.voiceRecords.length} 次口语练习</p></div></div><StorageUsage /><OrphanAudioCleanup records={data.voiceRecords} onNotify={onNotify} /><div className="storage-features"><span><HardDrive size={15} />书籍与笔记离线可用</span><span><ShieldCheck size={15} />书籍文件不上传；学习记录同步可选</span><span><HardDrive size={15} />录音独立存储，JSON 备份不含音频文件</span></div><div className="backup-buttons"><Button variant="secondary" onClick={onExport}><Download size={16} />导出备份</Button><Button variant="ghost" onClick={() => fileRef.current?.click()}><Upload size={16} />恢复备份</Button><input ref={fileRef} hidden type="file" accept=".json,application/json" onChange={(event) => void importBackup(event.target.files?.[0])} /></div></section><LearningSyncCard onNotify={onNotify} /><AudioBinding books={books} onNotify={onNotify} /><section className="settings-card glass-panel about-card"><img src="/linguaflow-icon.png" alt="" /><span className="eyebrow">LINGUAFLOW READER</span><h2>Read. Notice. Remember.</h2><p>Version 0.1.0 · Local-first PWA</p><small>阅读不是收集更多内容，而是让一些内容真正进入自己。</small></section></div></div></div>;
}

// 学习记录上云（opt-in）。默认关闭；开启前把「同步什么、为什么、书籍仍留本机」讲清楚。
function LearningSyncCard({ onNotify }: { onNotify?: (message: string) => void }) {
  const [enabled, setEnabled] = useState(isSyncEnabled());
  const [token, setToken] = useState(getSyncToken());
  const [pending, setPending] = useState(pendingCount());
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [busy, setBusy] = useState(false);

  const toggle = (on: boolean) => {
    setSyncEnabled(on);
    setEnabled(on);
    if (on) void flushQueue().then((r) => setPending(r.pending));
  };
  const connect = async () => {
    if (!username.trim() || !password) { onNotify?.('请填写用户名和密码'); return; }
    setBusy(true);
    const result = await connectAccount(username.trim(), password, mode);
    setBusy(false);
    if (!result.ok) { onNotify?.(result.error || '连接失败'); return; }
    setToken(getSyncToken());
    const r = await flushQueue();
    setPending(r.pending);
    onNotify?.(mode === 'register' ? '账号已创建，学习记录同步已开启' : '已连接账号，学习记录同步已开启');
  };
  const syncNow = async () => {
    setBusy(true);
    const r = await flushQueue();
    setBusy(false);
    setPending(r.pending);
    onNotify?.(r.sent ? `已同步 ${r.sent} 条学习记录` : r.pending ? '暂时无法同步，联网后会自动重试' : '没有待同步的记录');
  };
  const disconnect = () => {
    clearSyncToken();
    setSyncEnabled(false);
    setToken('');
    setEnabled(false);
    onNotify?.('已断开账号并关闭同步');
  };

  return <section className="settings-card glass-panel"><div className="settings-card-head"><CloudUpload size={20} /><div><h2>学习记录同步（可选）</h2><p>让 pathmora 读懂你的学习，为你制定计划。</p></div></div>
    <p className="sync-consent">开启后，你的查词、收藏句子、跟读与复习记录会同步到你的账号，供 pathmora 制定学习计划。<strong>你的书籍文件仍只留在本设备。</strong>可随时关闭；离线时记录先存本机，联网后补传。</p>
    <div className="setting-row"><div><strong>同步学习记录</strong><span>{enabled ? '已开启' : '默认关闭，不收集任何记录'}</span></div><Toggle checked={enabled} onChange={toggle} label="同步学习记录" /></div>
    {enabled && !token && <div className="sync-form">
      <div className="sync-mode"><button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>创建账号</button><button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>已有账号</button></div>
      <label className="sync-field"><span>用户名</span><input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder="起一个名字" /></label>
      <label className="sync-field"><span>密码</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} placeholder="至少 6 位" /></label>
      <Button disabled={busy} onClick={() => void connect()}><LogIn size={16} />{busy ? '连接中…' : mode === 'register' ? '创建并连接' : '连接账号'}</Button>
    </div>}
    {enabled && token && <div className="sync-connected">
      <div className="storage-status"><span className="online" /><div><strong>账号已连接</strong><p>{pending ? `${pending} 条记录待同步` : '学习记录已是最新'}</p></div></div>
      <div className="backup-buttons"><Button variant="secondary" disabled={busy} onClick={() => void syncNow()}><RefreshCw size={16} />立即同步</Button><Button variant="ghost" onClick={disconnect}>断开账号</Button></div>
    </div>}
  </section>;
}
