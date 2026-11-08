import { useEffect, useState } from 'react';
import { HardDrive } from 'lucide-react';

function readable(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1048576))} MB`;
}

/**
 * 本机存储用量。数据全部留在浏览器里，所以「还剩多少空间」是用户真正需要的信息——
 * 之前写失败只会静默丢数据，现在至少能提前看到配额快满了。
 * Safari 等不实现 navigator.storage.estimate() 的环境安静返回 null，不占位、不报错。
 */
export default function StorageUsage() {
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);

  useEffect(() => {
    if (!navigator.storage?.estimate) return;
    let active = true;
    const load = () => {
      void navigator.storage.estimate()
        .then((value) => {
          if (active) setEstimate({ usage: Number(value.usage || 0), quota: Number(value.quota || 0) });
        })
        .catch(() => undefined);
    };
    load();
    // 用户切回页面时刷新：录音、绑定音频、对齐数据都会改变占用。
    window.addEventListener('focus', load);
    return () => { active = false; window.removeEventListener('focus', load); };
  }, []);

  if (!estimate) return null;
  const percent = estimate.quota > 0 ? Math.min(100, (estimate.usage / estimate.quota) * 100) : 0;

  return <div className="storage-quota">
    <div className="storage-quota-head"><HardDrive size={14} /><span>本机占用 {readable(estimate.usage)}{estimate.quota > 0 ? ` / 配额 ${readable(estimate.quota)}` : ''}</span></div>
    {estimate.quota > 0 && <>
      <div className="quota-bar"><span style={{ width: `${Math.max(1, percent)}%` }} /></div>
      <small>{percent < 1 ? '<1' : percent.toFixed(0)}% 已用 · 录音与书籍音频都算在这里面</small>
    </>}
  </div>;
}
