import type { AppData } from '../types';
import type { BookAlignment } from './bookAlignment';

const DB_NAME = 'linguaflow-reader';
const STORE = 'workspace';
const VOICE_STORE = 'voice-audio';
const BOOK_AUDIO_STORE = 'book-audio';
const ALIGNMENT_STORE = 'alignment';
const TTS_AUDIO_STORE = 'tts-audio';
const KEY = 'reader-data-v1';

/** 最近一次成功读写的通道，供设置页如实展示存储状态（而不是把「初始化完成」当成「IDB 已连接」）。 */
export type StorageChannel = 'indexeddb' | 'localstorage' | 'none';
let lastChannel: StorageChannel = 'none';
export function getStorageChannel(): StorageChannel { return lastChannel; }

// ── 跨标签页同步 ─────────────────────────────────────────────────────────────
// 整个应用状态是一份快照，任何标签页写盘都是「整份覆盖」。若两个标签页同时开着，
// 一个停留在旧快照的标签页一旦写盘（改设置/翻页都会触发），就会把另一个标签页刚收藏的
// 词整份抹掉。这里在每次成功写盘后把最新快照广播给其它标签页，让它们「采纳」而非覆盖：
//   · BroadcastChannel 直接送整份快照（现代浏览器）；
//   · localStorage 信号键触发 storage 事件（老 Safari 兜底），收到信号的标签页回 IDB 取最新。
// 发送方自身不会收到自己的广播（BroadcastChannel / storage 事件都不回送本标签），故无自激环。
const SIGNAL_KEY = 'reader-data-v1-signal';
const CHANNEL_NAME = 'linguaflow-reader-sync';
let syncChannel: BroadcastChannel | null = null;
function getSyncChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!syncChannel) syncChannel = new BroadcastChannel(CHANNEL_NAME);
  return syncChannel;
}
function broadcastSaved(data: AppData): void {
  try { getSyncChannel()?.postMessage({ type: 'saved', data }); } catch { /* 广播失败不影响本标签落盘 */ }
  try { localStorage.setItem(SIGNAL_KEY, String(data.rev || Date.now())); } catch { /* 信号键写不了就只靠 BroadcastChannel */ }
}
/** 订阅其它标签页的写盘：onData 收到整份快照；onSignal 仅收到「有更新」信号（需自行回 IDB 取）。返回取消订阅。 */
export function subscribeExternalSave(onData: (data: AppData) => void, onSignal: () => void): () => void {
  const channel = getSyncChannel();
  const handleMessage = (event: MessageEvent) => { if (event.data?.type === 'saved' && event.data.data) onData(event.data.data as AppData); };
  channel?.addEventListener('message', handleMessage);
  const handleStorage = (event: StorageEvent) => { if (event.key === SIGNAL_KEY) onSignal(); };
  window.addEventListener('storage', handleStorage);
  return () => { channel?.removeEventListener('message', handleMessage); window.removeEventListener('storage', handleStorage); };
}

// 复用单条连接：此前每次操作都 open() 且从不 close()，长会话会累积连接；
// 缓存后旧标签页升级版本时也能通过 onversionchange 主动让位。
let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 5);
    let settled = false;
    // 旧标签页握着低版本连接时 open(4) 会触发 blocked 且永不 settle；
    // 没有超时兜底的话 loadData 的 catch 接不到 hang，App 会永久停在 loading。
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('本地数据库打开超时：可能被另一个标签页占用，请关闭其他标签后重试'));
    }, 6000);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(VOICE_STORE)) db.createObjectStore(VOICE_STORE);
      // 用户为任意书籍绑定的原声音频，按 bookId 存 Blob。
      if (!db.objectStoreNames.contains(BOOK_AUDIO_STORE)) db.createObjectStore(BOOK_AUDIO_STORE);
      // 运行时 Whisper 对齐结果，按 bookId 存 {t,s,e}[]。
      if (!db.objectStoreNames.contains(ALIGNMENT_STORE)) db.createObjectStore(ALIGNMENT_STORE);
      // 用户自带 Qwen TTS 合成出的音频，按内容键存 {blob,at}，刷新/重启后 0 请求复用。
      if (!db.objectStoreNames.contains(TTS_AUDIO_STORE)) db.createObjectStore(TTS_AUDIO_STORE);
    };
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true;
      window.clearTimeout(timer);
      const db = request.result;
      // 别的标签页要升级版本时让出连接，下次操作重新 open。
      db.onversionchange = () => { db.close(); dbPromise = null; };
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(request.error);
    };
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

export async function loadData(): Promise<AppData | null> {
  try {
    const db = await openDatabase();
    const data = await new Promise<AppData | null>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve((request.result as AppData | undefined) || null);
      request.onerror = () => reject(request.error);
    });
    lastChannel = 'indexeddb';
    return data;
  } catch {
    // localStorage 兜底里的 JSON.parse 也可能抛（备份损坏）。若让它冒泡到 App 的初始化
    // IIFE，setReady(true) 将永不执行，页面会永久停在 loading —— 这里必须吞掉并降级为「无本地数据」。
    try {
      const fallback = localStorage.getItem(KEY);
      lastChannel = 'localstorage';
      return fallback ? JSON.parse(fallback) as AppData : null;
    } catch {
      lastChannel = 'none';
      return null;
    }
  }
}

export async function saveData(data: AppData): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(data, KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    lastChannel = 'indexeddb';
    broadcastSaved(data);
  } catch {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      lastChannel = 'localstorage';
      broadcastSaved(data);
    } catch {
      // 两个通道都写不了：必须让调用方知道，不能静默丢数据。
      lastChannel = 'none';
      throw new Error('本地存储写入失败：IndexedDB 与 localStorage 都不可用或配额已满');
    }
  }
}

function writeBlob(store: string, id: string, blob: Blob): Promise<void> {
  return openDatabase().then((db) => new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(store, 'readwrite');
    transaction.objectStore(store).put(blob, id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  }));
}

function readBlob(store: string, id: string): Promise<Blob | null> {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).get(id);
    request.onsuccess = () => resolve((request.result as Blob | undefined) || null);
    request.onerror = () => reject(request.error);
  }));
}

function removeBlob(store: string, id: string): Promise<void> {
  return openDatabase().then((db) => new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(store, 'readwrite');
    transaction.objectStore(store).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  }));
}

export const saveVoiceAudio = (id: string, blob: Blob) => writeBlob(VOICE_STORE, id, blob);
export const getVoiceAudio = (id: string) => readBlob(VOICE_STORE, id);
export const deleteVoiceAudio = (id: string) => removeBlob(VOICE_STORE, id);

/** 列出所有录音 Blob 的 id，用于找出「没有对应练习记录」的孤儿文件。 */
export function listVoiceAudioIds(): Promise<string[]> {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const request = db.transaction(VOICE_STORE, 'readonly').objectStore(VOICE_STORE).getAllKeys();
    request.onsuccess = () => resolve((request.result as IDBValidKey[]).map(String));
    request.onerror = () => reject(request.error);
  }));
}

/**
 * 找出「有 Blob、没有对应练习记录」的孤立录音 id。
 * 刻意**只检测、不删除**：导入旧备份时按 id 差集自动删，会误删本机新录、还没进备份的音。
 * 删除一律交给用户在 OrphanAudioCleanup 里手动确认；restore 后只用它来提示孤儿数量。
 */
export async function findOrphanVoiceAudioIds(records: { id: string }[]): Promise<string[]> {
  const ids = await listVoiceAudioIds();
  const known = new Set(records.map((record) => record.id));
  return ids.filter((id) => !known.has(id));
}

// —— 用户绑定的书本原音（独立于 AppData，不进 JSON 备份，不受 slimForStorage 影响）——
export const saveBookAudio = (bookId: string, blob: Blob) => writeBlob(BOOK_AUDIO_STORE, bookId, blob);
export const getBookAudio = (bookId: string) => readBlob(BOOK_AUDIO_STORE, bookId);
export const deleteBookAudio = (bookId: string) => removeBlob(BOOK_AUDIO_STORE, bookId);

export function listBookAudioIds(): Promise<string[]> {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const request = db.transaction(BOOK_AUDIO_STORE, 'readonly').objectStore(BOOK_AUDIO_STORE).getAllKeys();
    request.onsuccess = () => resolve((request.result as IDBValidKey[]).map(String));
    request.onerror = () => reject(request.error);
  }));
}

// —— 运行时生成的句级时间戳（按 bookId 缓存，重开浏览器不用重跑）——
export function saveAlignment(bookId: string, alignment: BookAlignment): Promise<void> {
  return openDatabase().then((db) => new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(ALIGNMENT_STORE, 'readwrite');
    transaction.objectStore(ALIGNMENT_STORE).put(alignment, bookId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  }));
}

export function getAlignment(bookId: string): Promise<BookAlignment | null> {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const request = db.transaction(ALIGNMENT_STORE, 'readonly').objectStore(ALIGNMENT_STORE).get(bookId);
    request.onsuccess = () => resolve((request.result as BookAlignment | undefined) || null);
    request.onerror = () => reject(request.error);
  }));
}

export function deleteAlignment(bookId: string): Promise<void> {
  return openDatabase().then((db) => new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(ALIGNMENT_STORE, 'readwrite');
    transaction.objectStore(ALIGNMENT_STORE).delete(bookId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  }));
}

export function listAlignmentIds(): Promise<string[]> {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const request = db.transaction(ALIGNMENT_STORE, 'readonly').objectStore(ALIGNMENT_STORE).getAllKeys();
    request.onsuccess = () => resolve((request.result as IDBValidKey[]).map(String));
    request.onerror = () => reject(request.error);
  }));
}

// —— 用户自带 Qwen TTS 合成音频（持久缓存，按内容键存；刷新/重启后 0 请求复用）——
// 存 {blob,at,size} 而非裸 Blob，是为了能按时间/体积做有界淘汰（音频会越攒越多）。
export interface TtsAudioRecord { blob: Blob; at: number; size: number }

export function saveTtsAudio(key: string, blob: Blob): Promise<void> {
  const record: TtsAudioRecord = { blob, at: Date.now(), size: blob.size };
  return openDatabase().then((db) => new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(TTS_AUDIO_STORE, 'readwrite');
    transaction.objectStore(TTS_AUDIO_STORE).put(record, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  }));
}

export function getTtsAudio(key: string): Promise<Blob | null> {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const request = db.transaction(TTS_AUDIO_STORE, 'readonly').objectStore(TTS_AUDIO_STORE).get(key);
    request.onsuccess = () => resolve((request.result as TtsAudioRecord | undefined)?.blob || null);
    request.onerror = () => reject(request.error);
  }));
}

export const deleteTtsAudio = (key: string) => removeBlob(TTS_AUDIO_STORE, key);

/** 读出全部条目的键/时间/体积（不含字节），供有界淘汰排序。 */
export function listTtsAudioMeta(): Promise<{ key: string; at: number; size: number }[]> {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(TTS_AUDIO_STORE, 'readonly');
    const store = tx.objectStore(TTS_AUDIO_STORE);
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    tx.oncomplete = () => {
      const keys = keysReq.result as IDBValidKey[];
      const vals = valsReq.result as TtsAudioRecord[];
      resolve(keys.map((k, i) => ({ key: String(k), at: vals[i]?.at || 0, size: vals[i]?.size || 0 })));
    };
    tx.onerror = () => reject(tx.error);
  }));
}

/** 有界淘汰：超出条数或总体积时删最旧，返回删除数。失败安静返回 0（不影响播放）。 */
export async function trimTtsAudio(maxEntries: number, maxBytes: number): Promise<number> {
  try {
    const meta = await listTtsAudioMeta();
    let total = meta.reduce((sum, m) => sum + m.size, 0);
    if (meta.length <= maxEntries && total <= maxBytes) return 0;
    const oldest = [...meta].sort((a, b) => a.at - b.at);
    let removed = 0;
    for (const item of oldest) {
      if (meta.length - removed <= maxEntries && total <= maxBytes) break;
      await deleteTtsAudio(item.key);
      total -= item.size;
      removed += 1;
    }
    return removed;
  } catch {
    return 0;
  }
}

/** 清空本机全部 TTS 合成缓存（设置页「清空缓存」用）。失败安静忽略。 */
export function clearTtsAudio(): Promise<void> {
  return openDatabase().then((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(TTS_AUDIO_STORE, 'readwrite');
    tx.objectStore(TTS_AUDIO_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  })).catch(() => undefined);
}
