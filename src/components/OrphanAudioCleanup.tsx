import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { VoiceRecord } from '../types';
import { deleteVoiceAudio, listVoiceAudioIds } from '../lib/db';
import { Button } from './UI';

/**
 * 清理「有 Blob、没有练习记录」的孤立录音文件。
 *
 * 刻意**不做自动 GC**：导入旧备份时按 id 差集自动删，会误删本机新录、还没进备份的音。
 * 这里只把孤儿列出来交给用户点一下，既不丢数据，也让 deleteVoiceAudio 不再是零引用。
 */
export default function OrphanAudioCleanup({ records, onNotify }: { records: VoiceRecord[]; onNotify?: (message: string) => void }) {
  const [orphans, setOrphans] = useState<string[]>([]);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  const scan = useCallback(async () => {
    try {
      const ids = await listVoiceAudioIds();
      const known = new Set(records.map((record) => record.id));
      setOrphans(ids.filter((id) => !known.has(id)));
    } catch { /* IndexedDB 不可用时不显示清理入口 */ }
    finally { setChecked(true); }
  }, [records]);

  useEffect(() => { void scan(); }, [scan]);

  const clean = async () => {
    if (!orphans.length) return;
    setBusy(true);
    try {
      await Promise.all(orphans.map((id) => deleteVoiceAudio(id).catch(() => undefined)));
      const count = orphans.length;
      setOrphans([]);
      onNotify?.(`已清理 ${count} 个孤立录音文件`);
    } finally { setBusy(false); }
  };

  if (!checked || !orphans.length) return null;
  return <div className="orphan-cleanup">
    <div><strong>发现 {orphans.length} 个孤立录音文件</strong><span>没有对应的练习记录（多为导入旧备份或写入失败留下），可安全清理。</span></div>
    <Button variant="ghost" size="sm" disabled={busy} onClick={() => void clean()}><Trash2 size={14} />清理</Button>
  </div>;
}
