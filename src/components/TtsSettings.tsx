import { useCallback, useEffect, useState } from 'react';
import { Check, Cloud, Database, FlaskConical, KeyRound, Trash2, Volume2 } from 'lucide-react';
import {
  DASHSCOPE_VOICES, OPENAI_VOICES, clearTtsCache, defaultTtsConfig, isTtsConfigured, synthesizeTts,
  type TtsConfig, type TtsProvider,
} from '../lib/qwenTts';
import { clearDurableTts, ttsCacheStats } from '../lib/ttsCache';
import { Button, Segmented } from './UI';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const PROVIDER_OPTIONS: { value: TtsProvider; label: string }[] = [
  { value: 'off', label: '关闭' },
  { value: 'dashscope', label: '阿里云百炼' },
  { value: 'openai', label: 'OpenAI 兼容' },
];

/** 语音朗读（TTS）设置：用户自带 Qwen TTS，两种接入协议。作为真人录音之外的高质量兜底。 */
export default function TtsSettingsCard({ tts, onTts, onNotify }: {
  tts: TtsConfig;
  onTts: (next: TtsConfig) => void;
  onNotify?: (message: string, tone?: 'error' | 'success') => void;
}) {
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [stats, setStats] = useState<{ count: number; bytes: number; ossReady: boolean } | null>(null);
  const config = tts ?? defaultTtsConfig();
  const configured = isTtsConfigured(config);

  const refreshStats = useCallback(() => { void ttsCacheStats().then(setStats); }, []);
  useEffect(() => { refreshStats(); }, [refreshStats]);

  const clearCache = async () => {
    setClearing(true);
    try {
      await clearDurableTts();
      clearTtsCache();
      refreshStats();
      onNotify?.('已清空本机发音缓存', 'success');
    } finally {
      setClearing(false);
    }
  };

  const patchDashscope = (patch: Partial<TtsConfig['dashscope']>) => onTts({ ...config, dashscope: { ...config.dashscope, ...patch } });
  const patchOpenai = (patch: Partial<TtsConfig['openai']>) => onTts({ ...config, openai: { ...config.openai, ...patch } });

  const preview = async () => {
    if (!configured) { onNotify?.('请先填写 API Key', 'error'); return; }
    setBusy(true);
    try {
      const url = await synthesizeTts('Hello, this is a voice preview from LinguaFlow Reader.', config);
      if (!url) { onNotify?.('合成失败：请检查 API Key、端点地址与音色是否可用', 'error'); return; }
      const audio = new Audio(url);
      await audio.play().catch(() => undefined);
      onNotify?.('试听成功，发音兜底已启用', 'success');
      refreshStats();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-card glass-panel tts-card">
      <div className="settings-card-head"><Volume2 size={20} /><div><h2>语音朗读（TTS）</h2><p>无真人录音时的高质量兜底，密钥只留在本设备。</p></div></div>
      <p className="tts-consent">单词仍优先词库真人录音；没有录音的句子、短语与整章朗读会用你配置的 Qwen TTS，音质优于浏览器自带朗读。未填写或合成失败时安静回退浏览器 TTS，始终能发音。密钥仅保存在本设备（随备份导出），合成直连你填写的端点。</p>
      <Segmented value={config.provider} options={PROVIDER_OPTIONS} onChange={(provider) => onTts({ ...config, provider })} label="TTS 接入协议" />

      {config.provider === 'dashscope' && (
        <div className="tts-fields">
          <label className="tts-field"><span><KeyRound size={13} />DashScope API Key</span><input type="password" value={config.dashscope.apiKey} onChange={(e) => patchDashscope({ apiKey: e.target.value })} placeholder="sk-…（阿里云百炼控制台获取）" autoComplete="off" /></label>
          <label className="tts-field"><span>端点地址（可选）</span><input value={config.dashscope.baseUrl} onChange={(e) => patchDashscope({ baseUrl: e.target.value })} placeholder="https://dashscope.aliyuncs.com" autoComplete="off" /></label>
          <div className="tts-field-row">
            <label className="tts-field"><span>模型</span><input value={config.dashscope.model} onChange={(e) => patchDashscope({ model: e.target.value })} placeholder="qwen3-tts-flash" autoComplete="off" /></label>
            <label className="tts-field"><span>音色</span><input list="tts-dashscope-voices" value={config.dashscope.voice} onChange={(e) => patchDashscope({ voice: e.target.value })} placeholder="Cherry" autoComplete="off" /></label>
          </div>
          <datalist id="tts-dashscope-voices">{DASHSCOPE_VOICES.map((v) => <option key={v} value={v} />)}</datalist>
          <p className="tts-hint">qwen3-tts-flash 一个模型覆盖中/英/日/韩等多语种；音色可填账号支持的任意名称。</p>
        </div>
      )}

      {config.provider === 'openai' && (
        <div className="tts-fields">
          <label className="tts-field"><span><KeyRound size={13} />API Key</span><input type="password" value={config.openai.apiKey} onChange={(e) => patchOpenai({ apiKey: e.target.value })} placeholder="sk-…" autoComplete="off" /></label>
          <label className="tts-field"><span>Base URL（到 /v1）</span><input value={config.openai.baseUrl} onChange={(e) => patchOpenai({ baseUrl: e.target.value })} placeholder="https://api.siliconflow.cn/v1" autoComplete="off" /></label>
          <div className="tts-field-row">
            <label className="tts-field"><span>模型</span><input value={config.openai.model} onChange={(e) => patchOpenai({ model: e.target.value })} placeholder="gpt-4o-mini-tts" autoComplete="off" /></label>
            <label className="tts-field"><span>音色</span><input list="tts-openai-voices" value={config.openai.voice} onChange={(e) => patchOpenai({ voice: e.target.value })} placeholder="alloy" autoComplete="off" /></label>
          </div>
          <datalist id="tts-openai-voices">{OPENAI_VOICES.map((v) => <option key={v} value={v} />)}</datalist>
          <p className="tts-hint">走 /audio/speech 兼容端点，可接硅基流动等第三方或自建服务；音色按服务商支持填写。</p>
        </div>
      )}

      {config.provider !== 'off' && (
        <div className="tts-actions">
          <span className={`tts-status ${configured ? 'on' : ''}`}>{configured ? <><Check size={13} />已启用兜底</> : '未填 API Key，仍用浏览器 TTS'}</span>
          <Button variant="secondary" size="sm" disabled={busy || !configured} onClick={() => void preview()}><FlaskConical size={15} />{busy ? '合成中…' : '试听'}</Button>
        </div>
      )}

      <div className="tts-cache">
        <div className="tts-cache-info">
          <span className="tts-cache-stat"><Database size={14} />本机缓存 {stats ? `${stats.count} 段 · ${formatBytes(stats.bytes)}` : '…'}</span>
          <span className={`tts-cache-oss ${stats?.ossReady ? 'on' : ''}`}><Cloud size={14} />{stats?.ossReady ? '已连接共享缓存，跨设备复用' : '登录后可跨设备共享缓存'}</span>
        </div>
        <Button variant="ghost" size="sm" disabled={clearing || !stats || stats.count === 0} onClick={() => void clearCache()}><Trash2 size={15} />{clearing ? '清空中…' : '清空缓存'}</Button>
      </div>
      <p className="tts-hint">合成过的发音会缓存到本机（刷新/离线 0 重复请求）；登录态再共享到云端 OSS，同一句全网只合成一次。清空只删本机副本，不影响云端共享。</p>
    </section>
  );
}
