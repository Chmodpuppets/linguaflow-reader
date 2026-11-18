import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DASHSCOPE_HOST, clearTtsCache, dashscopeHost, defaultTtsConfig, isTtsConfigured,
  synthesizeTts, ttsCacheKey, type TtsConfig,
} from '../../src/lib/qwenTts';

const dashscope = (overrides: Partial<TtsConfig['dashscope']> = {}): TtsConfig => ({
  ...defaultTtsConfig(),
  provider: 'dashscope',
  dashscope: { ...defaultTtsConfig().dashscope, apiKey: 'sk-test', ...overrides },
});
const openai = (overrides: Partial<TtsConfig['openai']> = {}): TtsConfig => ({
  ...defaultTtsConfig(),
  provider: 'openai',
  openai: { ...defaultTtsConfig().openai, apiKey: 'sk-test', baseUrl: 'https://api.example.com/v1', ...overrides },
});

test('defaultTtsConfig 默认关闭且带两套协议默认值', () => {
  const c = defaultTtsConfig();
  assert.equal(c.provider, 'off');
  assert.equal(c.dashscope.model, 'qwen3-tts-flash');
  assert.equal(c.dashscope.baseUrl, DEFAULT_DASHSCOPE_HOST);
  assert.equal(c.openai.voice, 'alloy');
});

test('isTtsConfigured：关闭/缺 Key/缺 baseUrl 均不可用', () => {
  assert.equal(isTtsConfigured(null), false);
  assert.equal(isTtsConfigured(defaultTtsConfig()), false);
  assert.equal(isTtsConfigured(dashscope({ apiKey: '  ' })), false);
  assert.equal(isTtsConfigured(dashscope()), true);
  assert.equal(isTtsConfigured(openai({ apiKey: '' })), false);
  assert.equal(isTtsConfigured(openai({ baseUrl: '' })), false);
  assert.equal(isTtsConfigured(openai()), true);
});

test('dashscopeHost 去掉 compatible-mode 与末尾斜杠', () => {
  assert.equal(dashscopeHost(''), DEFAULT_DASHSCOPE_HOST);
  assert.equal(dashscopeHost('https://dashscope.aliyuncs.com/compatible-mode/v1'), 'https://dashscope.aliyuncs.com');
  assert.equal(dashscopeHost('https://dashscope.aliyuncs.com/'), 'https://dashscope.aliyuncs.com');
  assert.equal(dashscopeHost('https://my.proxy.com/v1'), 'https://my.proxy.com/v1');
});

test('ttsCacheKey 区分协议/音色/文本', () => {
  assert.notEqual(ttsCacheKey(dashscope(), 'hi'), ttsCacheKey(openai(), 'hi'));
  assert.notEqual(ttsCacheKey(dashscope({ voice: 'Cherry' }), 'hi'), ttsCacheKey(dashscope({ voice: 'Ethan' }), 'hi'));
  assert.equal(ttsCacheKey(dashscope(), 'hi'), ttsCacheKey(dashscope(), 'hi'));
});

test('synthesizeTts：未配置或空文本返回 null', async () => {
  assert.equal(await synthesizeTts('hello', defaultTtsConfig()), null);
  assert.equal(await synthesizeTts('   ', dashscope()), null);
});

test('synthesizeTts dashscope：POST 原生端点并取 output.audio.url', async () => {
  clearTtsCache();
  const calls: { url: string; body: any }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ output: { audio: { url: 'https://cdn.example/a.mp3' } } }) };
  }) as any;
  try {
    const url = await synthesizeTts('hello world', dashscope());
    assert.equal(url, 'https://cdn.example/a.mp3');
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith('/api/v1/services/aigc/multimodal-generation/generation'));
    assert.equal(calls[0].body.model, 'qwen3-tts-flash');
    assert.equal(calls[0].body.input.text, 'hello world');
    assert.equal(calls[0].body.input.voice, 'Cherry');
  } finally {
    globalThis.fetch = original;
  }
});

test('synthesizeTts dashscope：无 url 时回退 base64 data URL', async () => {
  clearTtsCache();
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ output: { audio: { data: 'QUJD' } } }) })) as any;
  try {
    assert.equal(await synthesizeTts('hi', dashscope()), 'data:audio/wav;base64,QUJD');
  } finally {
    globalThis.fetch = original;
  }
});

test('synthesizeTts openai：POST /audio/speech 并把 blob 转 object URL', async () => {
  clearTtsCache();
  const calls: { url: string; body: any }[] = [];
  const originalFetch = globalThis.fetch;
  const originalCreate = (URL as any).createObjectURL;
  const originalRevoke = (URL as any).revokeObjectURL;
  globalThis.fetch = (async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, blob: async () => ({ size: 123 }) };
  }) as any;
  (URL as any).createObjectURL = () => 'blob:mock-audio';
  (URL as any).revokeObjectURL = () => {};
  try {
    const url = await synthesizeTts('hello', openai());
    assert.equal(url, 'blob:mock-audio');
    assert.ok(calls[0].url.endsWith('/audio/speech'));
    assert.equal(calls[0].body.input, 'hello');
    assert.equal(calls[0].body.voice, 'alloy');
    assert.equal(calls[0].body.response_format, 'mp3');
  } finally {
    globalThis.fetch = originalFetch;
    (URL as any).createObjectURL = originalCreate;
    (URL as any).revokeObjectURL = originalRevoke;
  }
});

test('synthesizeTts：HTTP 失败/无音频返回 null', async () => {
  clearTtsCache();
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: false, status: 401, json: async () => ({ message: 'bad key' }) })) as any;
  try {
    assert.equal(await synthesizeTts('hi', dashscope()), null);
  } finally {
    globalThis.fetch = original;
  }
});

test('synthesizeTts：同文本+音色命中会话缓存，不重复请求', async () => {
  clearTtsCache();
  let count = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { count += 1; return { ok: true, json: async () => ({ output: { audio: { url: 'https://cdn.example/b.mp3' } } }) }; }) as any;
  try {
    const c = dashscope();
    assert.equal(await synthesizeTts('cache me', c), 'https://cdn.example/b.mp3');
    assert.equal(await synthesizeTts('cache me', c), 'https://cdn.example/b.mp3');
    assert.equal(count, 1);
  } finally {
    globalThis.fetch = original;
  }
});
