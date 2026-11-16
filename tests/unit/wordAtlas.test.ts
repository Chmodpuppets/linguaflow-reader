import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAtlasKey, lemmaCandidates, mapAtlasEntry, atlasMediaUrls,
  loadAtlasIndex, lookupAtlas, atlasGloss, atlasIndexReady, __resetAtlas,
  MEDIA_IMG, MEDIA_UK, MEDIA_US, MEDIA_EX, MEDIA_EX1,
} from '../../src/lib/wordAtlas';

test('normalizeAtlasKey：小写 + 折叠空白', () => {
  assert.equal(normalizeAtlasKey('  Give   UP '), 'give up');
});

test('lemmaCandidates：规则变形还原候选', () => {
  assert.ok(lemmaCandidates('books').includes('book'));
  assert.ok(lemmaCandidates('wandered').includes('wander'));
  assert.ok(lemmaCandidates('running').includes('run'));
  assert.ok(lemmaCandidates('stopped').includes('stop'));
  assert.ok(lemmaCandidates('making').includes('make'));
  assert.ok(lemmaCandidates('cities').includes('city'));
});

test('mapAtlasEntry：灌入 DictionaryEntry + 保留富字段', () => {
  const raw = {
    w: 'wander', uk: 'ˈwɒndə', us: 'ˈwɑːndər',
    senses: [{ pos: 'v.', zh: '漫步', en: 'to walk slowly' }],
    ex: [{ en: 'We wandered the streets.', zh: '我们在街上漫步。' }],
    col: ['wander around'], fam: ['wanderer'], syn: ['roam'], ant: ['stay'], tip: '慢慢走，没有目的地。',
  };
  const a = mapAtlasEntry(raw, 'id1', 'B2', 'travel', '旅行', 15, 'wandered');
  assert.equal(a.word, 'wander');
  assert.equal(a.cefr, 'B2');
  assert.equal(a.topicZh, '旅行');
  assert.equal(a.lemmaOf, 'wandered');
  assert.equal(a.entry.phonetic, 'ˈwɒndə');
  assert.equal(a.entry.partOfSpeech, 'v.');
  assert.equal(a.entry.chinese, '漫步');
  assert.equal(a.entry.meaning, 'to walk slowly');
  assert.equal(a.entry.example, 'We wandered the streets.');
  assert.equal(a.entry.exampleCn, '我们在街上漫步。');
  assert.deepEqual(a.entry.synonyms, ['roam']);
});

test('atlasMediaUrls：按媒体位标记生成 URL', () => {
  const m15 = atlasMediaUrls('x', MEDIA_IMG | MEDIA_UK | MEDIA_US | MEDIA_EX);
  assert.ok(m15.img && m15.thumb && m15.uk && m15.us && m15.ex);
  assert.equal(m15.ex1, undefined);
  const m31 = atlasMediaUrls('x', 31);
  assert.ok(m31.ex1);
  assert.deepEqual(atlasMediaUrls('x', 0), {});
  assert.ok(atlasMediaUrls('x', MEDIA_EX1).ex1);
});

// ── 加载器（mock fetch）──────────────────────────────────────────────────────
const INDEX = {
  chunk: 2, count: 3, cefr: ['A1', 'B2'], topics: [['animals', '动物']],
  words: [
    ['a1', 'wander', 'v. 漫步', 'ˈwɒndə', 1, 0, 15],
    ['a2', 'curious', 'adj. 好奇的', 'ˈkjʊəriəs', 0, 0, 31],
    ['a3', 'book', 'n. 书', 'bʊk', 0, 0, 1],
  ],
};
const BLOCK0 = [
  { w: 'wander', uk: 'ˈwɒndə', senses: [{ pos: 'v.', zh: '漫步', en: 'walk' }], ex: [], col: [], fam: [], syn: [], ant: [], tip: '' },
  { w: 'curious', uk: 'ˈkjʊəriəs', senses: [{ pos: 'adj.', zh: '好奇的', en: 'eager to know' }], ex: [], col: [], fam: [], syn: [], ant: [], tip: '' },
];
const BLOCK1 = [
  { w: 'book', uk: 'bʊk', senses: [{ pos: 'n.', zh: '书', en: 'a written work' }], ex: [], col: [], fam: [], syn: [], ant: [], tip: '' },
];
function mockFetch() {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string) => {
    const u = String(url);
    const data = u.endsWith('atlas/index.json') ? INDEX
      : u.endsWith('atlas/entries/0.json') ? BLOCK0
      : u.endsWith('atlas/entries/1.json') ? BLOCK1 : null;
    return { ok: !!data, json: async () => data } as Response;
  }) as typeof fetch;
}

test('lookupAtlas：精确命中 + 词形还原 + 未收录 null', async () => {
  __resetAtlas(); mockFetch();
  const exact = await lookupAtlas('wander');
  assert.equal(exact?.word, 'wander');
  assert.equal(exact?.cefr, 'B2');
  assert.equal(exact?.topicZh, '动物');
  const lemma = await lookupAtlas('wandered');
  assert.equal(lemma?.word, 'wander');
  assert.equal(lemma?.lemmaOf, 'wander');
  const plural = await lookupAtlas('books');
  assert.equal(plural?.word, 'book');
  assert.equal(await lookupAtlas('zzzznotaword'), null);
});

test('atlasGloss：索引就绪后同步取注音释义（去词性前缀）', async () => {
  __resetAtlas(); mockFetch();
  assert.equal(atlasIndexReady(), false);
  assert.equal(atlasGloss('curious'), null); // 未加载
  await loadAtlasIndex();
  assert.equal(atlasIndexReady(), true);
  assert.deepEqual(atlasGloss('curious'), { zh: '好奇的', phonetic: 'ˈkjʊəriəs' });
  assert.deepEqual(atlasGloss('books'), { zh: '书', phonetic: 'bʊk' }); // 还原
  assert.equal(atlasGloss('zzzznotaword'), null);
});

test('loadAtlasIndex：失败返回 null 不抛错（回退在线词典）', async () => {
  __resetAtlas();
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => ({ ok: false, json: async () => null }) as Response) as typeof fetch;
  assert.equal(await loadAtlasIndex(), null);
  assert.equal(await lookupAtlas('wander'), null);
});
