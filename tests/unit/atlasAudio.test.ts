import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickWordRecordingUrl } from '../../src/lib/atlasAudio';
import { MEDIA_IMG, MEDIA_UK, MEDIA_US, type AtlasWord } from '../../src/lib/wordAtlas';

// pickWordRecordingUrl 是纯函数：按词条媒体位取真人录音 URL（美式优先→英式），无录音返回 undefined。
const entry = (id: string, media: number) => ({ id, media }) as unknown as AtlasWord;

test('pickWordRecordingUrl：无词条返回 undefined', () => {
  assert.equal(pickWordRecordingUrl(null), undefined);
});

test('pickWordRecordingUrl：有美式录音优先取美式', () => {
  const url = pickWordRecordingUrl(entry('curious', MEDIA_UK | MEDIA_US));
  assert.ok(url?.endsWith('/audio/us/curious.mp3'));
  assert.ok(url?.includes('pathmora.oss-cn-beijing.aliyuncs.com/atlas/v1'));
});

test('pickWordRecordingUrl：仅英式录音时取英式', () => {
  const url = pickWordRecordingUrl(entry('wander', MEDIA_UK));
  assert.ok(url?.endsWith('/audio/uk/wander.mp3'));
});

test('pickWordRecordingUrl：只有插画无录音返回 undefined（回退 TTS）', () => {
  assert.equal(pickWordRecordingUrl(entry('library', MEDIA_IMG)), undefined);
});
