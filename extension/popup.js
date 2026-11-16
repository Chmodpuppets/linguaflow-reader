/** 弹窗：显示待同步条数、打开阅读器、清空队列。 */
(function () {
  const countEl = document.getElementById('count');
  const openBtn = document.getElementById('open');
  const clearBtn = document.getElementById('clear');

  function refresh() {
    chrome.runtime.sendMessage({ type: 'lf-count' }, (response) => {
      void chrome.runtime.lastError;
      countEl.textContent = String(response && typeof response.count === 'number' ? response.count : 0);
    });
  }

  openBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://reader.pathmora.cn/' });
    window.close();
  });

  clearBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'lf-clear' }, () => {
      void chrome.runtime.lastError;
      refresh();
    });
  });

  refresh();
})();
