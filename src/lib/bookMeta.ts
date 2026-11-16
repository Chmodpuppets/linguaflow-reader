import type { Book } from '../types';

// 书籍元数据编辑（标题/作者/简介/封面）的纯逻辑 + 封面缩放。
// 纯函数部分可在 node 单测；resizeCoverImage 依赖浏览器 canvas，仅在组件里调用。

export const BOOK_TITLE_MAX = 120;
export const BOOK_AUTHOR_MAX = 80;
export const BOOK_DESC_MAX = 2000;
/** 封面最长边像素：上传图缩到此尺寸内，避免 dataURL 撑大备份。 */
export const COVER_MAX_DIM = 640;
/** 上传封面原图大小上限（缩放前），超过则拒绝。 */
export const COVER_MAX_BYTES = 8 * 1024 * 1024;

/** 去掉首尾空白并截断到上限；用于标题/作者/简介。 */
export function cleanMetaText(value: string, max: number): string {
  return (value || '').trim().slice(0, max);
}

export interface BookMetaDraft {
  title: string;
  author: string;
  description: string;
  coverImage?: string;
}

/** 把编辑草稿整理成可写入 Book 的补丁：标题为空时回退「未命名书籍」，作者/简介允许清空。 */
export function buildBookUpdate(draft: BookMetaDraft): Partial<Book> {
  const title = cleanMetaText(draft.title, BOOK_TITLE_MAX) || '未命名书籍';
  const author = cleanMetaText(draft.author, BOOK_AUTHOR_MAX);
  const description = cleanMetaText(draft.description, BOOK_DESC_MAX);
  const update: Partial<Book> = { title, author, description };
  // coverImage 显式传 undefined 表示移除封面；传字符串表示设置/替换。
  update.coverImage = draft.coverImage;
  return update;
}

/** 是否为可接受的封面图片类型。 */
export function isCoverFile(file: { type: string }): boolean {
  return /^image\/(png|jpe?g|webp|gif)$/i.test(file.type || '');
}

/**
 * 读取图片文件并等比缩放到 COVER_MAX_DIM 内，输出 JPEG dataURL。
 * 仅浏览器可用；类型/大小不合法时抛错（组件捕获后提示）。
 */
export async function resizeCoverImage(file: File): Promise<string> {
  if (!isCoverFile(file)) throw new Error('请选择 PNG / JPG / WebP / GIF 图片');
  if (file.size > COVER_MAX_BYTES) throw new Error('图片太大（请小于 8MB）');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('图片无法读取'));
      image.src = url;
    });
    const scale = Math.min(1, COVER_MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器不支持封面处理');
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
