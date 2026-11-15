import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBackup } from '../../src/lib/backup';

const settings = { fontSize: 18, lineHeight: 1.8, theme: 'midnight', reducedAmbient: false };
const base = { books: [], vocabulary: [], highlights: [], reviewLogs: [], voiceRecords: [], settings };

test('validateBackup：最小合法备份通过', () => {
  assert.doesNotThrow(() => validateBackup(base));
});

test('validateBackup：缺少数据列表拒绝', () => {
  const { books: _books, ...rest } = base;
  assert.throws(() => validateBackup(rest), /缺少必要的数据列表/);
});

test('validateBackup：空 chapters 的 EPUB 拒绝', () => {
  assert.throws(() => validateBackup({ ...base, books: [{ id: 'x', title: 'B', source: 'epub', chapters: [] }] }), /没有可阅读的章节/);
});

test('validateBackup：样书允许空 chapters（hydrate 时还原正文）', () => {
  assert.doesNotThrow(() => validateBackup({ ...base, books: [{ id: 's', title: 'S', source: 'sample', chapters: [] }] }));
});

test('validateBackup：缺 metrics 的练习记录拒绝', () => {
  assert.throws(() => validateBackup({ ...base, voiceRecords: [{ id: 'v' }] }), /口语练习记录损坏/);
});

test('validateBackup：无法识别的主题拒绝', () => {
  assert.throws(() => validateBackup({ ...base, settings: { ...settings, theme: 'neon' } }), /主题设置无法识别/);
});

test('validateBackup：完整的合法练习记录通过', () => {
  const record = { id: 'v', createdAt: '2026-01-01', mode: 'shadowing', targetText: 't', transcript: 't', diffTokens: [], metrics: { wpm: 100, pauseRatio: 10, accuracy: 90, duration: 30, wordCount: 50, fillerCount: 1 } };
  assert.doesNotThrow(() => validateBackup({ ...base, voiceRecords: [record] }));
});

test('validateBackup：PDF 书（有正文 + 标签）通过；空 chapters 拒绝', () => {
  assert.doesNotThrow(() => validateBackup({ ...base, books: [{ id: 'p', title: 'P', source: 'pdf', tags: ['科幻'], chapters: [{ id: 'c', title: 'C', paragraphs: ['hello'] }] }] }));
  assert.throws(() => validateBackup({ ...base, books: [{ id: 'p', title: 'P', source: 'pdf', chapters: [] }] }), /没有可阅读的章节/);
});

test('validateBackup：非法标签拒绝', () => {
  assert.throws(() => validateBackup({ ...base, books: [{ id: 's', title: 'S', source: 'sample', chapters: [], tags: [123] }] }), /标签格式不正确/);
});

test('validateBackup：保存的视图合法通过 / 损坏拒绝', () => {
  const view = { id: 'v', name: 'n', query: '', sortMode: 'default', onlyIdeal: false, tag: '' };
  assert.doesNotThrow(() => validateBackup({ ...base, libraryViews: [view] }));
  assert.throws(() => validateBackup({ ...base, libraryViews: [{ id: 'v' }] }), /保存的视图损坏/);
  assert.throws(() => validateBackup({ ...base, libraryViews: 'nope' }), /保存的视图列表格式不正确/);
});
