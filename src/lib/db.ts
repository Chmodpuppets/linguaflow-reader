import type { AppData } from '../types';
import type { BookAlignment } from './bookAlignment';

const DB_NAME = 'linguaflow-reader';
const STORE = 'workspace';
const VOICE_STORE = 'voice-audio';
const BOOK_AUDIO_STORE = 'book-audio';
const ALIGNMENT_STORE = 'alignment';
const KEY = 'reader-data-v1';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 4);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(VOICE_STORE)) db.createObjectStore(VOICE_STORE);
      // 用户为任意书籍绑定的原声音频，按 bookId 存 Blob。
      if (!db.objectStoreNames.contains(BOOK_AUDIO_STORE)) db.createObjectStore(BOOK_AUDIO_STORE);
      // 运行时 Whisper 对齐结果，按 bookId 存 {t,s,e}[]。
      if (!db.objectStoreNames.contains(ALIGNMENT_STORE)) db.createObjectStore(ALIGNMENT_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadData(): Promise<AppData | null> {
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve((request.result as AppData | undefined) || null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    // localStorage 兜底里的 JSON.parse 也可能抛（备份损坏）。若让它冒泡到 App 的初始化
    // IIFE，setReady(true) 将永不执行，页面会永久停在 loading —— 这里必须吞掉并降级为「无本地数据」。
    try {
      const fallback = localStorage.getItem(KEY);
      return fallback ? JSON.parse(fallback) as AppData : null;
    } catch {
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
  } catch {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      // 两个通道都写不了：必须让调用方知道，不能静默丢数据。
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
