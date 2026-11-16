import test from 'node:test';
import assert from 'node:assert/strict';
import { addBookToPlaylist, moveBook, nextIndex, prevIndex, removeBookFromPlaylist, resolvePlaylistBooks } from '../../src/lib/playlist';
import type { Book, Playlist } from '../../src/types';

const book = (id: string) => ({ id, title: id }) as unknown as Book;
const playlist = (bookIds: string[]): Playlist => ({ id: 'p', name: 'n', bookIds, createdAt: '2026-01-01' });

test('resolvePlaylistBooks 按序解析、跳过缺失、去重', () => {
  const books = [book('a'), book('b'), book('c')];
  assert.deepEqual(resolvePlaylistBooks(playlist(['c', 'a', 'gone', 'c']), books).map((b) => b.id), ['c', 'a']);
  assert.deepEqual(resolvePlaylistBooks(playlist([]), books), []);
});

test('addBookToPlaylist 去重追加，不改动原数组', () => {
  const ids = ['a', 'b'];
  assert.deepEqual(addBookToPlaylist(ids, 'c'), ['a', 'b', 'c']);
  assert.deepEqual(addBookToPlaylist(ids, 'a'), ['a', 'b']);
  assert.deepEqual(addBookToPlaylist(ids, ''), ['a', 'b']);
  assert.deepEqual(ids, ['a', 'b']);
});

test('removeBookFromPlaylist 移除指定曲目', () => {
  assert.deepEqual(removeBookFromPlaylist(['a', 'b', 'c'], 'b'), ['a', 'c']);
  assert.deepEqual(removeBookFromPlaylist(['a'], 'gone'), ['a']);
});

test('moveBook 重排并夹取越界', () => {
  assert.deepEqual(moveBook(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(moveBook(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(moveBook(['a', 'b', 'c'], 0, 99), ['b', 'c', 'a']);
  assert.deepEqual(moveBook(['a', 'b', 'c'], 5, 0), ['a', 'b', 'c']);
});

test('nextIndex/prevIndex 边界（连播到末尾停止，不循环）', () => {
  assert.equal(nextIndex(0, 3), 1);
  assert.equal(nextIndex(2, 3), null);
  assert.equal(nextIndex(0, 1), null);
  assert.equal(prevIndex(2), 1);
  assert.equal(prevIndex(0), null);
});
