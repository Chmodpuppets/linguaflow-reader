/**
 * 阅读器同源 bridge content script：把 background 队列里的收藏投递给阅读器页面。
 * 页面（src/App.tsx）监听 postMessage 并入词汇本/句子，再回执 lf-imported；bridge 据此清队列。
 * 页面可能晚于 bridge 就绪，故对未回执的条目定时重投，直到被采纳。
 */
(function () {
  const LF = globalThis.LFExt;
  if (!LF || typeof chrome === 'undefined' || !chrome.runtime) return;

  let pending = [];
  let retryTimer = 0;

  function flush() {
    if (!pending.length) return;
    window.postMessage({ source: LF.SOURCE, type: 'lf-import', items: pending }, location.origin);
  }

  function scheduleRetry() {
    window.clearTimeout(retryTimer);
    if (pending.length) retryTimer = window.setTimeout(() => { flush(); scheduleRetry(); }, 2000);
  }

  function offer(items) {
    if (!Array.isArray(items) || !items.length) return;
    const map = new Map(pending.map((item) => [item.id, item]));
    for (const item of items) if (item && item.id) map.set(item.id, item);
    pending = [...map.values()];
    flush();
    scheduleRetry();
  }

  // 上线主动拉取（即便没有新采集，也能把之前积压的收藏补进阅读器）。
  try {
    chrome.runtime.sendMessage({ type: 'lf-pull' }, (response) => {
      void chrome.runtime.lastError;
      if (response && response.items) offer(response.items);
    });
  } catch { /* 扩展上下文失效忽略 */ }

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'lf-deliver') offer(message.items);
  });

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== LF.SOURCE || data.type !== 'lf-imported' || !Array.isArray(data.ids)) return;
    const acked = new Set(data.ids);
    pending = pending.filter((item) => !acked.has(item.id));
    if (!pending.length) window.clearTimeout(retryTimer);
    try {
      chrome.runtime.sendMessage({ type: 'lf-ack', ids: data.ids }, () => { void chrome.runtime.lastError; });
    } catch { /* 忽略 */ }
  });

  // 回到前台时再补投一次（标签页可能在后台时错过了投递）。
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { flush(); scheduleRetry(); } });
})();
