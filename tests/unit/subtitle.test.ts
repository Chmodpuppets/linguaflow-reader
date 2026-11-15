import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTimestamp, cleanCueText, parseSubtitles, cuesToChunks, isSubtitleFile } from '../../src/lib/subtitle';

test('parseTimestamp：SRT 逗号 / VTT 点号 / 省略小时 / 非法', () => {
  assert.equal(parseTimestamp('00:00:01,000'), 1);
  assert.equal(parseTimestamp('00:01:02.500'), 62.5);
  assert.equal(parseTimestamp('01:02:03.250'), 3723.25);
  assert.equal(parseTimestamp('02:03.400'), 123.4); // MM:SS.mmm
  assert.equal(parseTimestamp('00:00:00,050'), 0.05);
  assert.equal(parseTimestamp('not a time'), null);
  assert.equal(parseTimestamp('00:75:00,000'), null); // 分钟越界
});

test('cleanCueText：去内联标签 / 实体 / 折叠空白', () => {
  assert.equal(cleanCueText('<i>Hello</i> &amp; welcome'), 'Hello & welcome');
  assert.equal(cleanCueText('a <00:00:02.000>karaoke<00:00:03.000> line'), 'a karaoke line');
  assert.equal(cleanCueText('  multiple   spaces\nhere  '), 'multiple spaces here');
  assert.equal(cleanCueText('&lt;tag&gt; &quot;q&quot; &#39;s&#39;'), '<tag> "q" \'s\'');
});

test('parseSubtitles：SRT 多句、多行合并、去重、按时间排序', () => {
  const srt = [
    '2', '00:00:05,000 --> 00:00:08,000', 'Second sentence', 'continued here.', '',
    '1', '00:00:01,000 --> 00:00:04,000', 'First sentence.', '',
    '3', '00:00:09,000 --> 00:00:12,000', 'First sentence.', '', // 重复 → 去掉
  ].join('\n');
  const cues = parseSubtitles(srt);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, 'First sentence.'); // 已按 start 排序
  assert.equal(cues[0].start, 1);
  assert.equal(cues[1].text, 'Second sentence continued here.');
  assert.equal(cues[1].end, 8);
});

test('parseSubtitles：VTT 头 / NOTE /  cue id / 设置行被正确跳过', () => {
  const vtt = [
    'WEBVTT', '',
    'NOTE this is a comment', 'should be ignored', '',
    'intro-1', '00:00:01.000 --> 00:00:04.000 align:start position:0%', '<b>Hello</b> world.', '',
    '00:00:05.000 --> 00:00:08.000', 'Second line.', '',
  ].join('\n');
  const cues = parseSubtitles(vtt);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, 'Hello world.');
  assert.equal(cues[0].start, 1);
  assert.equal(cues[1].text, 'Second line.');
});

test('parseSubtitles：空内容 / 无 --> 块返回空；end<=start 兜底最短 0.25s', () => {
  assert.deepEqual(parseSubtitles('WEBVTT\n\njust text no timing'), []);
  const cues = parseSubtitles('1\n00:00:01,000 --> 00:00:01,000\nSame start end.\n');
  assert.equal(cues.length, 1);
  assert.ok(cues[0].end >= cues[0].start + 0.25);
});

test('cuesToChunks / isSubtitleFile', () => {
  const cues = parseSubtitles('1\n00:00:01,000 --> 00:00:04,000\nHello there.\n');
  const chunks = cuesToChunks(cues);
  assert.deepEqual(chunks, [{ start: 1, end: 4, text: 'Hello there.' }]);
  assert.equal(isSubtitleFile('movie.srt'), true);
  assert.equal(isSubtitleFile('movie.VTT'), true);
  assert.equal(isSubtitleFile('movie.mp3'), false);
});
