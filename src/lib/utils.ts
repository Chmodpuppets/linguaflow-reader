export function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value));
}

export function readingMinutes(bookParagraphs: number): number {
  return Math.max(2, Math.round(bookParagraphs * 1.4));
}

export function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // 立即 revoke 会让部分浏览器（尤其 Safari）来不及启动下载；延迟回收。
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
