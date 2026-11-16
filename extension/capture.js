/**
 * 采集 content script（任意网页）：划选后浮现一个小药丸，一键把词/短语/整句收藏到 LinguaFlow。
 * 用 Shadow DOM 隔离样式，避免与宿主页面互相污染。采集到的条目交给 background 入队。
 */
(function () {
  const LF = globalThis.LFExt;
  if (!LF || typeof chrome === 'undefined' || !chrome.runtime) return;

  const HOST_ID = 'linguaflow-capture-host';
  let host = null;
  let shadow = null;
  let pill = null;
  let feedbackTimer = 0;
  let lastSelection = '';

  const STYLE = `
    :host { all: initial; }
    .lf-pill {
      position: fixed; z-index: 2147483647; display: flex; align-items: center; gap: 4px;
      padding: 4px 6px; border-radius: 999px; background: #0f172a; color: #f8fafc;
      box-shadow: 0 6px 24px rgba(2,6,23,.35); font: 500 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
      user-select: none;
    }
    .lf-pill button {
      appearance: none; border: 0; cursor: pointer; border-radius: 999px; padding: 5px 10px;
      background: #14b8a6; color: #042f2e; font: 600 13px/1 inherit; display: inline-flex; align-items: center; gap: 5px;
    }
    .lf-pill button.lf-secondary { background: #334155; color: #e2e8f0; }
    .lf-pill button:hover { filter: brightness(1.08); }
    .lf-pill .lf-close { background: transparent; color: #94a3b8; padding: 5px 6px; font-size: 14px; }
    .lf-pill .lf-mark { width: 14px; height: 14px; border-radius: 4px; background: linear-gradient(135deg,#2dd4bf,#0ea5e9); display:inline-block; }
    .lf-pill.lf-done button { display: none; }
    .lf-pill .lf-feedback { display: none; padding: 5px 10px; color: #5eead4; font-weight: 600; }
    .lf-pill.lf-done .lf-feedback { display: inline-flex; align-items: center; gap: 5px; }
  `;

  function ensureHost() {
    if (host && document.documentElement.contains(host)) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;';
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    shadow.appendChild(style);
    pill = document.createElement('div');
    pill.className = 'lf-pill';
    pill.innerHTML = `
      <span class="lf-mark"></span>
      <button type="button" data-action="word">收藏</button>
      <button type="button" class="lf-secondary" data-action="sentence">整句</button>
      <button type="button" class="lf-close" data-action="close" aria-label="关闭">×</button>
      <span class="lf-feedback">✓ 已收藏</span>
    `;
    pill.addEventListener('mousedown', (event) => event.stopPropagation());
    pill.addEventListener('click', onClick);
    shadow.appendChild(pill);
    document.documentElement.appendChild(host);
  }

  function hide() {
    if (host) host.style.display = 'none';
    lastSelection = '';
  }

  function paragraphText(selection) {
    try {
      const range = selection.getRangeAt(0);
      let node = range.commonAncestorContainer;
      if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
      const block = node && node.closest ? node.closest('p, li, td, blockquote, article, section, div, h1, h2, h3, h4, h5, h6') : null;
      const text = block ? block.textContent : (node ? node.textContent : '');
      return (text || selection.toString()).slice(0, 4000);
    } catch {
      return selection.toString();
    }
  }

  function show(selection) {
    const text = LF.normalizeText(selection.toString());
    if (!text || text.length < 1) { hide(); return; }
    lastSelection = text;
    ensureHost();
    host.style.display = 'block';
    pill.classList.remove('lf-done');
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const pillWidth = 190;
    let left = rect.left + rect.width / 2 - pillWidth / 2;
    let top = rect.bottom + 8;
    left = Math.max(8, Math.min(left, window.innerWidth - pillWidth - 8));
    if (top + 40 > window.innerHeight) top = Math.max(8, rect.top - 44);
    pill.style.left = `${left}px`;
    pill.style.top = `${top}px`;
    pill.dataset.paragraph = paragraphText(selection);
  }

  function onClick(event) {
    const button = event.target.closest('button');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'close') { hide(); return; }
    const selection = window.getSelection();
    const text = LF.normalizeText(selection && selection.toString ? selection.toString() : lastSelection);
    if (!text) { hide(); return; }
    const item = LF.makeItem({
      selection: text,
      paragraph: pill.dataset.paragraph || text,
      kind: action === 'sentence' ? 'sentence' : undefined,
      url: location.href,
      title: document.title,
    });
    try {
      chrome.runtime.sendMessage({ type: 'lf-capture', item }, () => {
        void chrome.runtime.lastError; // 吞掉「无接收方」错误，避免控制台噪声
      });
    } catch { /* 扩展上下文失效时静默 */ }
    pill.classList.add('lf-done');
    window.clearTimeout(feedbackTimer);
    feedbackTimer = window.setTimeout(hide, 1100);
  }

  document.addEventListener('mouseup', () => {
    window.setTimeout(() => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim()) show(selection);
      else hide();
    }, 10);
  }, true);

  document.addEventListener('mousedown', (event) => {
    if (host && event.composedPath().includes(host)) return;
    hide();
  }, true);
  document.addEventListener('scroll', hide, true);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hide(); }, true);
})();
