/**
 * LinguaFlow 网页收藏扩展 —— 共享纯逻辑（采集 / 队列）。
 *
 * 以经典脚本加载（content script 与 background importScripts 都用它），把工具挂到 globalThis.LFExt。
 * 无 DOM / chrome 依赖，可在 node 里 import 后单测（import 本文件即执行赋值）。
 * 阅读器侧的合并逻辑在 src/lib/extensionImport.ts；SOURCE 常量两边保持一致。
 */
(function () {
  const SOURCE = 'linguaflow-extension';
  const QUEUE_KEY = 'lfQueue';
  const MAX_QUEUE = 500;
  const MAX_TEXT = 400;

  function normalizeText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function wordCount(text) {
    const matches = normalizeText(text).match(/[A-Za-z][A-Za-z'-]*/g);
    return matches ? matches.length : 0;
  }

  function isPhrase(text) {
    return wordCount(text) >= 2;
  }

  function textKey(text) {
    return normalizeText(text).toLowerCase();
  }

  /** 从段落里取出包含划选内容的那一句；找不到就回退到划选附近的一段窗口。 */
  function contextSentence(paragraph, selection) {
    const para = normalizeText(paragraph);
    const sel = normalizeText(selection);
    if (!para) return sel;
    if (!sel) return para.slice(0, 200);
    const sentences = para.split(/(?<=[.!?。！？])\s+/);
    const lowerSel = sel.toLowerCase();
    for (const sentence of sentences) {
      if (sentence.toLowerCase().includes(lowerSel)) return sentence.trim();
    }
    const index = para.toLowerCase().indexOf(lowerSel);
    if (index < 0) return sel;
    const start = Math.max(0, index - 80);
    const end = Math.min(para.length, index + sel.length + 80);
    return para.slice(start, end).trim();
  }

  function makeId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /**
   * 由划选构造一条收藏。kind 显式指定 'sentence' 时收藏整句，否则按词数判定 word / phrase。
   * paragraph 是划选所在段落文本，用于提取上下文句。
   */
  function makeItem(options) {
    const selection = normalizeText(options.selection).slice(0, MAX_TEXT);
    const paragraph = options.paragraph || '';
    const url = options.url || '';
    const title = normalizeText(options.title).slice(0, 200);
    const createdAt = new Date().toISOString();
    if (options.kind === 'sentence') {
      const sentence = contextSentence(paragraph, selection) || selection;
      return { id: makeId(), kind: 'sentence', text: sentence.slice(0, MAX_TEXT), context: sentence.slice(0, MAX_TEXT), sourceUrl: url, sourceTitle: title, createdAt };
    }
    const kind = isPhrase(selection) ? 'phrase' : 'word';
    return { id: makeId(), kind, text: selection, context: contextSentence(paragraph, selection), sourceUrl: url, sourceTitle: title, createdAt };
  }

  /** 入队去重（同 kind+文本只留最新一条），最新在前，限制总量。 */
  function mergeQueue(queue, item) {
    const list = Array.isArray(queue) ? queue : [];
    if (!item || !item.text) return list.slice(0, MAX_QUEUE);
    const key = `${item.kind}:${textKey(item.text)}`;
    const filtered = list.filter((entry) => `${entry.kind}:${textKey(entry.text)}` !== key);
    return [item, ...filtered].slice(0, MAX_QUEUE);
  }

  function removeByIds(queue, ids) {
    const list = Array.isArray(queue) ? queue : [];
    const drop = new Set(Array.isArray(ids) ? ids : []);
    return list.filter((entry) => !drop.has(entry.id));
  }

  globalThis.LFExt = { SOURCE, QUEUE_KEY, MAX_QUEUE, normalizeText, wordCount, isPhrase, textKey, contextSentence, makeItem, mergeQueue, removeByIds };
})();
