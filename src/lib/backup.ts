import type { AppData } from '../types';

/**
 * 备份的条目级校验：只查顶层数组形状不够 —— 畸形条目（空 chapters、缺 metrics /
 * diffTokens）会通过恢复，然后在打开书或统计页时抛错白屏。在这里整份拒绝并说清原因。
 * 抽成纯函数便于单元测试（不依赖 React / 浏览器）。
 */
export function validateBackup(parsed: unknown): AppData {
  const raw = parsed as Record<string, unknown>;
  const lists = ['books', 'vocabulary', 'highlights', 'reviewLogs', 'voiceRecords'];
  if (lists.some((key) => !Array.isArray(raw[key]))) throw new Error('缺少必要的数据列表');
  const settings = raw.settings as Record<string, unknown> | undefined;
  if (!settings || typeof settings.fontSize !== 'number' || typeof settings.lineHeight !== 'number') throw new Error('阅读版式设置不完整');
  if (!['midnight', 'sepia', 'paper'].includes(String(settings.theme))) throw new Error('主题设置无法识别');
  const str = (value: unknown) => typeof value === 'string';
  const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
  (raw.books as unknown[]).forEach((item, index) => {
    const book = item as Record<string, unknown>;
    if (!book || !str(book.id) || !str(book.title) || !['sample', 'epub'].includes(String(book.source)) || !Array.isArray(book.chapters)) throw new Error(`第 ${index + 1} 本书的条目损坏（缺少 id / 标题 / 章节）`);
    (book.chapters as unknown[]).forEach((chapter) => {
      const ch = chapter as Record<string, unknown>;
      if (!ch || !str(ch.id) || !str(ch.title) || !Array.isArray(ch.paragraphs) || (ch.paragraphs as unknown[]).some((p) => !str(p))) throw new Error(`《${String(book.title)}》的章节数据损坏`);
    });
    // 导入的 EPUB 必须有正文；样书正文由 hydrate 从静态内容还原，允许空 chapters。
    if (book.source === 'epub' && !(book.chapters as unknown[]).length) throw new Error(`《${String(book.title)}》没有可阅读的章节`);
  });
  (raw.vocabulary as unknown[]).forEach((item, index) => {
    const entry = item as Record<string, unknown>;
    if (!entry || !str(entry.id) || !str(entry.word) || !str(entry.dueAt) || !num(entry.familiarity)) throw new Error(`第 ${index + 1} 个词条损坏`);
  });
  (raw.highlights as unknown[]).forEach((item, index) => {
    const mark = item as Record<string, unknown>;
    if (!mark || !str(mark.id) || !str(mark.bookId) || !str(mark.text) || !num(mark.paragraphIndex)) throw new Error(`第 ${index + 1} 条标记损坏`);
  });
  (raw.reviewLogs as unknown[]).forEach((item, index) => {
    const log = item as Record<string, unknown>;
    if (!log || !str(log.id) || !str(log.vocabId) || !['again', 'hard', 'good', 'easy'].includes(String(log.result))) throw new Error(`第 ${index + 1} 条复习记录损坏`);
  });
  (raw.voiceRecords as unknown[]).forEach((item, index) => {
    const record = item as Record<string, unknown>;
    const metrics = record?.metrics as Record<string, unknown> | undefined;
    if (!record || !str(record.id) || !str(record.createdAt) || !Array.isArray(record.diffTokens) || !metrics || !['wpm', 'pauseRatio', 'accuracy', 'duration', 'wordCount', 'fillerCount'].every((key) => num(metrics[key]))) throw new Error(`第 ${index + 1} 条口语练习记录损坏（缺少 metrics / diffTokens）`);
  });
  return parsed as AppData;
}
