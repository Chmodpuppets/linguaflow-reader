/**
 * background service worker：收藏队列的真相来源。
 * 采集页把条目送来入队（chrome.storage.local），并尝试即时投递给已打开的阅读器标签；
 * 阅读器同源 bridge 上线时主动 pull，采纳后 ack 清队列。图标徽章显示待收藏条数。
 */
importScripts('lib.js');
const LF = globalThis.LFExt;

const READER_MATCHES = [
  'https://reader.pathmora.cn/*',
  'http://localhost:3012/*',
  'http://127.0.0.1:3012/*',
];

async function getQueue() {
  const stored = await chrome.storage.local.get(LF.QUEUE_KEY);
  return Array.isArray(stored[LF.QUEUE_KEY]) ? stored[LF.QUEUE_KEY] : [];
}

async function setQueue(queue) {
  await chrome.storage.local.set({ [LF.QUEUE_KEY]: queue });
  await updateBadge(queue.length);
}

async function updateBadge(count) {
  try {
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#0f766e' });
  } catch { /* 某些时机 action 不可用，忽略 */ }
}

async function deliverToReader(items) {
  if (!items.length) return;
  try {
    const tabs = await chrome.tabs.query({ url: READER_MATCHES });
    for (const tab of tabs) {
      if (tab.id == null) continue;
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'lf-deliver', items });
      } catch { /* 该标签 bridge 尚未就绪，忽略；上线时会主动 pull */ }
    }
  } catch { /* tabs 查询失败忽略 */ }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (!message || typeof message.type !== 'string') { sendResponse({ ok: false }); return; }
    if (message.type === 'lf-capture') {
      const queue = LF.mergeQueue(await getQueue(), message.item);
      await setQueue(queue);
      await deliverToReader(queue);
      sendResponse({ ok: true, count: queue.length });
      return;
    }
    if (message.type === 'lf-pull') {
      sendResponse({ ok: true, items: await getQueue() });
      return;
    }
    if (message.type === 'lf-ack') {
      const queue = LF.removeByIds(await getQueue(), message.ids);
      await setQueue(queue);
      sendResponse({ ok: true, count: queue.length });
      return;
    }
    if (message.type === 'lf-count') {
      sendResponse({ ok: true, count: (await getQueue()).length });
      return;
    }
    if (message.type === 'lf-clear') {
      await setQueue([]);
      sendResponse({ ok: true, count: 0 });
      return;
    }
    sendResponse({ ok: false });
  })();
  return true; // 异步 sendResponse
});

chrome.runtime.onInstalled.addListener(() => { void updateBadge(0); });