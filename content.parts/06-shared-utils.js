'use strict';
// ---- 跨片段共享原语：文本清洗 / 哈希 / 滚动定位 / 等待（01-turns、09-export、10、11、12 共用）----
// 函数声明在 isolated world 顶层全局提升，加载顺序不影响调用；新增函数须保持无状态纯原语定位，禁止在此挂 UI 或持长期状态。

  function cleanTurnText(el) {
    const clone = el.cloneNode(true);
    // Phase-3: pre 先转 ```lang 围栏(代码语言保留),再删注入节点取文本;查找/复制/采集复用同一口径
    try {
      clone.querySelectorAll('pre').forEach(pre => {
        const code = pre.querySelector('code');
        const src = code || pre;
        const lang = parseCodeLang(((code?.className || '') + ' ' + (pre.className || '')));
        const body = ((code?.innerText ?? src.innerText ?? src.textContent) || '').replace(/\s+$/, '');
        const fenced = body ? fenceCode(lang, body) : '';
        if (fenced) pre.replaceWith(document.createTextNode('\n' + fenced + '\n'));
      });
    } catch {}
    clone.querySelectorAll('.doc-qtag,.doc-expand,.doc-thinkbtn,#docdeep-outline,#docdeep-tools,#docdeep-find,#docdeep-export-progress,#docdeep-export-dialog').forEach(n => n.remove());
    return (clone.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  function hashText(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function parseCodeLang(className) {
    const m = String(className || '').toLowerCase().match(/language-([a-z0-9+#-]+)/);
    return m ? m[1] : '';
  }
  function fenceCode(lang, code) {
    const body = String(code ?? '').replace(/\s+$/, '');
    if (!body) return '';
    return '```' + String(lang || '') + '\n' + body + '\n```';
  }

  function stripQuestionLabel(text) {
    return text.replace(/^Q\d+ · 我的提问\s*/, '').trim();
  }

  function scrollToExact(container, top) {
    try { container.scrollTo({ top, behavior: 'auto' }); }
    catch { container.scrollTop = top; }
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
