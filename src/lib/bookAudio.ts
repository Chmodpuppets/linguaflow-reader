import { useEffect, useRef, useState } from 'react';
import { getBookAudio } from './db';

export const BOOK_AUDIO_EVENT = 'lf:book-audio-changed';

/** 绑定/解绑后广播，让所有正在使用音频的组件重新解析 object URL，无需刷新页面。 */
export function notifyBookAudioChanged(bookId: string): void {
  window.dispatchEvent(new CustomEvent<string>(BOOK_AUDIO_EVENT, { detail: bookId }));
}

export interface BookAudioSource {
  /** 可直接给 <audio src> 用；用户绑定时是 object URL，否则是 book.audio 静态路径。 */
  src?: string;
  /** 是否为「用户自己的音频」——用户音频没有预计算句级时间戳，不能用内置书的时间轴去 seek。 */
  isUserAudio: boolean;
}

/**
 * 解析一本书可播放的音频地址。
 *
 * 设计要点：绑定状态完全由 IndexedDB book-audio store 决定，**不写进 Book**。
 * 这样就不会被 App.tsx 的 slimForStorage（剥离 sample 书的 audio）或 hydrateBooks
 * （用静态内容整体覆盖）在刷新时抹掉，也不需要改动 AppData 结构。
 *
 * - 有用户音频 → 优先播放（内置书也能换成自己的版本）
 * - 没有 → 回退 book.audio（内置静态 URL）
 * - 都没有 → undefined，调用方走 TTS 示范
 *
 * object URL 由本 hook 独占管理：切换 / 卸载 / 重新绑定时 revoke，不留 Blob URL 泄漏。
 */
export function useBookAudioSrc(bookId?: string, staticUrl?: string): BookAudioSource {
  const [userUrl, setUserUrl] = useState<string | undefined>();
  const objectUrlRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    const release = () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = undefined;
      }
    };
    const load = () => {
      if (!bookId) { release(); if (active) setUserUrl(undefined); return; }
      void getBookAudio(bookId).then((blob) => {
        if (!active) return;
        release();
        if (blob) {
          const url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          setUserUrl(url);
        } else setUserUrl(undefined);
      }).catch(() => {
        if (!active) return;
        release();
        setUserUrl(undefined);
      });
    };
    load();
    const onChange = (event: Event) => {
      const changedId = (event as CustomEvent<string>).detail;
      if (!changedId || changedId === bookId) load();
    };
    window.addEventListener(BOOK_AUDIO_EVENT, onChange);
    return () => {
      active = false;
      window.removeEventListener(BOOK_AUDIO_EVENT, onChange);
      release();
    };
  }, [bookId]);

  return { src: userUrl || staticUrl, isUserAudio: Boolean(userUrl) };
}
