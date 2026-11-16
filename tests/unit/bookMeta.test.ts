import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBookUpdate, cleanMetaText, isCoverFile, BOOK_TITLE_MAX } from '../../src/lib/bookMeta';

test('cleanMetaText：去首尾空白并截断到上限', () => {
  assert.equal(cleanMetaText('  Hello  ', 120), 'Hello');
  assert.equal(cleanMetaText('abcdef', 3), 'abc');
  assert.equal(cleanMetaText('', 10), '');
});

test('buildBookUpdate：标题为空回退「未命名书籍」，作者/简介可清空', () => {
  const update = buildBookUpdate({ title: '   ', author: '  ', description: '', coverImage: undefined });
  assert.equal(update.title, '未命名书籍');
  assert.equal(update.author, '');
  assert.equal(update.description, '');
  assert.equal(update.coverImage, undefined); // 显式移除封面
});

test('buildBookUpdate：保留并清洗标题/作者/简介，封面原样传递', () => {
  const update = buildBookUpdate({ title: ' 小王子 ', author: ' 圣埃克苏佩里 ', description: ' 一个关于爱与责任的故事 ', coverImage: 'data:image/jpeg;base64,xxx' });
  assert.equal(update.title, '小王子');
  assert.equal(update.author, '圣埃克苏佩里');
  assert.equal(update.description, '一个关于爱与责任的故事');
  assert.equal(update.coverImage, 'data:image/jpeg;base64,xxx');
});

test('buildBookUpdate：超长标题截断到上限', () => {
  const update = buildBookUpdate({ title: 'x'.repeat(BOOK_TITLE_MAX + 50), author: '', description: '' });
  assert.equal(update.title?.length, BOOK_TITLE_MAX);
});

test('isCoverFile：接受常见图片类型，拒绝其它', () => {
  assert.equal(isCoverFile({ type: 'image/png' }), true);
  assert.equal(isCoverFile({ type: 'image/jpeg' }), true);
  assert.equal(isCoverFile({ type: 'image/webp' }), true);
  assert.equal(isCoverFile({ type: 'image/gif' }), true);
  assert.equal(isCoverFile({ type: 'application/pdf' }), false);
  assert.equal(isCoverFile({ type: '' }), false);
});
