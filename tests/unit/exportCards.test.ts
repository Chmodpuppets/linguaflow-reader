import test from 'node:test';
import assert from 'node:assert/strict';
import { cardsFromSentences, cardsFromVocab, highlightWordHtml, mergeCards, toAnkiTsv, toCsv } from '../../src/lib/exportCards';
import type { SavedSentence, VocabEntry } from '../../src/types';

const vocab = (over: Partial<VocabEntry> = {}): VocabEntry => ({
  id: 'v1', word: 'garden', context: 'The garden was quiet.', bookId: 'b', bookTitle: 'Book', chapterId: 'c', chapterTitle: 'Ch1', paragraphIndex: 0, note: '',
  dictionary: { word: 'garden', phonetic: '/ˈɡɑːdn/', partOfSpeech: 'n', meaning: 'a plot of plants', chinese: '花园', usage: '', example: '', exampleCn: '', synonyms: [] },
  createdAt: '2026-01-01', familiarity: 1, dueAt: '2026-01-02', reviewCount: 0, ...over,
});
const sentence = (over: Partial<SavedSentence> = {}): SavedSentence => ({
  id: 's1', text: 'A rose bloomed in the garden.', word: 'garden', meaning: '花园', phonetic: '/ˈɡɑːdn/', bookId: 'b', bookTitle: 'Book', chapterId: 'c', chapterTitle: 'Ch1', paragraphIndex: 0, createdAt: '2026-01-01', ...over,
});

test('highlightWordHtml 整词加粗并转义', () => {
  assert.equal(highlightWordHtml('The garden was quiet.', 'garden'), 'The <b>garden</b> was quiet.');
  assert.equal(highlightWordHtml('gardens are big', 'garden'), 'gardens are big'); // 整词边界
  assert.equal(highlightWordHtml('<script>x</script>', 'x'), '&lt;script&gt;<b>x</b>&lt;/script&gt;');
});

test('cardsFromVocab / cardsFromSentences 提取字段', () => {
  const [c] = cardsFromVocab([vocab()]);
  assert.equal(c.word, 'garden'); assert.equal(c.meaning, '花园'); assert.equal(c.source, 'Book · Ch1');
  const [s] = cardsFromSentences([sentence()]);
  assert.equal(s.sentence, 'A rose bloomed in the garden.');
});

test('mergeCards 按词+句去重', () => {
  const merged = mergeCards(cardsFromVocab([vocab()]), cardsFromSentences([sentence(), sentence({ id: 's2' })]));
  assert.equal(merged.length, 2); // vocab 句 + 一个不同句；重复句被去掉
});

test('toAnkiTsv 带指令头、HTML、制表符两列', () => {
  const tsv = toAnkiTsv(cardsFromVocab([vocab()]));
  assert.ok(tsv.startsWith('#separator:tab\n#html:true'));
  const row = tsv.trim().split('\n').pop()!;
  const [front, back] = row.split('\t');
  assert.ok(front.includes('<b>garden</b>'));
  assert.ok(back.includes('花园'));
  assert.equal(row.split('\t').length, 2);
});

test('toCsv 表头 + 引号转义', () => {
  const csv = toCsv(cardsFromVocab([vocab({ context: 'He said, "hello", then left.' })]));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], 'Word,Sentence,Meaning,Phonetic,Source');
  assert.ok(lines[1].includes('"He said, ""hello"", then left."'));
});
