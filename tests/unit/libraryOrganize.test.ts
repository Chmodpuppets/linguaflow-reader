import test from 'node:test';
import assert from 'node:assert/strict';
import { allTags, filterByTag, parseTags, viewMatches } from '../../src/lib/libraryOrganize';
import type { LibraryView } from '../../src/types';

test('allTags 汇总去重排序', () => {
  assert.deepEqual(allTags([{ tags: ['科幻', '在读'] }, { tags: ['在读', '历史'] }, { tags: [] }, {}]), ['在读', '历史', '科幻'].sort((a, b) => a.localeCompare(b)));
});

test('filterByTag 按标签筛选，空标签返回全部', () => {
  const books = [{ id: 'a', tags: ['科幻'] }, { id: 'b', tags: ['历史'] }, { id: 'c', tags: [] }];
  assert.deepEqual(filterByTag(books, '科幻').map((b) => b.id), ['a']);
  assert.equal(filterByTag(books, '').length, 3);
  assert.equal(filterByTag(books, '不存在').length, 0);
});

test('parseTags 切分/去空白/去重/限长', () => {
  assert.deepEqual(parseTags('科幻， 在读 ; 科幻、历史\n'), ['科幻', '在读', '历史']);
  assert.deepEqual(parseTags('  '), []);
  assert.equal(parseTags('a'.repeat(40)).length, 1);
  assert.ok(parseTags(Array.from({ length: 20 }, (_, i) => `t${i}`).join(',')).length <= 12);
});

test('viewMatches 判定当前组合是否等于视图', () => {
  const view: LibraryView = { id: 'v', name: 'n', query: 'cat', sortMode: 'match', onlyIdeal: true, tag: '科幻' };
  assert.equal(viewMatches(view, { query: 'cat', sortMode: 'match', onlyIdeal: true, tag: '科幻' }), true);
  assert.equal(viewMatches(view, { query: 'cat', sortMode: 'default', onlyIdeal: true, tag: '科幻' }), false);
});
