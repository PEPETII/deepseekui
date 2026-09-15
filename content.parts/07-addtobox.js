'use strict';

  // ---- 选区「添加到输入框」：会话正文里选中文字后浮出一键送入输入框的小按钮 ----
  // 只读原文选区、注入自有按钮（.docdeep-injected），不碰 DeepSeek 原生选中菜单与表单。
  // 插入走底层 textarea：富文本表面在线时强制重渲染，保持「表面即所见」。
  let addBoxBtn = null;
  let addBoxListeners = [];
  let addBoxScheduleTimer = 0;

  // 纯函数（行为测试边界）：把 text 插入 value 的 [start,end) 区间，返回新值与插入后光标位。
  // 仅「光标在非空正文末尾追加」时补空行分段，避免新片段与草稿末行粘连；中段插入/选区替换原样插入。
  function composeComposerInsert(value, start, end, text) {
    const source = String(value ?? '');
    const limit = source.length;
    const safeStart = Number.isFinite(start) ? Math.max(0, Math.min(limit, Math.trunc(start))) : limit;
    const safeEnd = Number.isFinite(end) ? Math.max(safeStart, Math.min(limit, Math.trunc(end))) : limit;
    const insert = String(text ?? '');
    if (!insert) return { value: source, caret: safeEnd, changed: false };
    // 分段仅在「光标停在非空正文末尾」时生效；选区替换即使延伸到末尾也按原样替换
    const atEnd = safeStart === limit && safeEnd === limit;
    let prefix = '';
    if (atEnd && limit > 0 && !/\n\n$/.test(source)) {
      prefix = source.endsWith('\n') ? '\n' : '\n\n';
    }
    const next = source.slice(0, safeStart) + prefix + insert + source.slice(safeEnd);
    return { value: next, caret: safeStart + prefix.length + insert.length, changed: next !== source };
  }

  // 选区准入：非折叠、有非空白文本、不来自原生输入控件或本扩展注入节点
  function addToBoxSelectionText() {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return '';
    const range = selection.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || !el.isConnected) return '';
    if (el.closest('textarea, input, [contenteditable="true"], select')) return '';
    if (el.closest('.' + INJECTED)) return '';
    const text = selection.toString();
    return text.trim() ? text : '';
  }

  function ensureAddToBoxButton() {
    if (addBoxBtn?.isConnected) return addBoxBtn;
    removeAddToBoxButton();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'docdeep-addtobox';
    btn.className = INJECTED;
    btn.hidden = true;
    btn.textContent = '添加到输入框';
    btn.setAttribute('aria-label', '将选中文字添加到底部输入框');
    // mousedown 阻止默认，保住页面选区不被点击动作折叠
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text = addToBoxSelectionText();
      hideAddToBox();
      if (text) insertAddToBoxText(text);
    });
    document.body.appendChild(btn);
    addBoxBtn = btn;
    return btn;
  }

  function hideAddToBox() {
    if (addBoxBtn) addBoxBtn.hidden = true;
  }

  // 纯函数（行为测试边界）：计算按钮落点。默认贴选区末行右端「下方」——Edge 的原生
  // 选中菜单锚定在选区起始端附近，放末行下方与它重叠的概率最低；下方放不下才回落
  // 选区上方，最后把左右都钳回视口内（贴边留 8px）。
  function addBoxAnchorPosition(anchor, btn, viewportWidth, viewportHeight) {
    const margin = 6;
    const edge = 8;
    const bw = Number(btn?.width) || 0;
    const bh = Number(btn?.height) || 0;
    const aTop = Number(anchor?.top) || 0;
    const aBottom = Number(anchor?.bottom) || 0;
    const aRight = Number(anchor?.right) || 0;
    let left = aRight + margin;
    if (left + bw > viewportWidth - edge) left = viewportWidth - bw - edge;
    left = Math.max(edge, left);
    let top = aBottom + margin;
    if (top + bh > viewportHeight - edge) top = aTop - bh - margin;
    top = Math.max(edge, Math.min(top, viewportHeight - bh - edge));
    return { left, top };
  }

  function positionAddToBox(range) {
    const btn = ensureAddToBoxButton();
    const rects = range.getClientRects();
    const anchor = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    if (!anchor || (!anchor.width && !anchor.height)) { hideAddToBox(); return; }
    btn.hidden = false;
    const btnRect = btn.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth || anchor.right;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight || anchor.bottom;
    const pos = addBoxAnchorPosition(anchor, btnRect, viewportWidth, viewportHeight);
    btn.style.left = Math.round(pos.left) + 'px';
    btn.style.top = Math.round(pos.top) + 'px';
  }

  function updateAddToBox() {
    if (!isOn() || settings.docdeep_addtobox === false) { hideAddToBox(); return; }
    const text = addToBoxSelectionText();
    if (!text) { hideAddToBox(); return; }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) { hideAddToBox(); return; }
    positionAddToBox(selection.getRangeAt(0));
  }

  function scheduleAddToBox() {
    if (addBoxScheduleTimer) clearTimeout(addBoxScheduleTimer);
    addBoxScheduleTimer = setTimeout(() => {
      addBoxScheduleTimer = 0;
      try { updateAddToBox(); } catch {}
    }, 80);
  }

  function insertAddToBoxText(text) {
    const ta = nativeComposerTextarea();
    if (!ta) return false;
    const value = String(ta.value || '');
    const hasCaret = Number.isFinite(ta.selectionStart) && Number.isFinite(ta.selectionEnd);
    const start = hasCaret ? ta.selectionStart : value.length;
    const end = hasCaret ? ta.selectionEnd : value.length;
    const result = composeComposerInsert(value, start, end, text);
    if (!result.changed) return false;
    const rich = richBinding?.editor?.isConnected ? richBinding : null;
    if (rich) {
      // 富文本表面在线：textarea 仍是 Markdown 底层，改值后强制重渲染表面并把光标放到末尾
      ta.value = result.value;
      rich.lastSerialized = result.value;
      syncRichFromTextarea(rich, true);
      const api = richModel();
      const modelLen = api && rich.model ? api.modelTextLength(rich.model) : result.caret;
      restoreRichSelection(rich, modelLen, modelLen, 'none');
      updateFormattingToolbarVisibility();
      scheduleRichEditorPosition();
      return true;
    }
    ta.value = result.value;
    focusAndSelectTextarea(ta, result.caret, result.caret, 'none');
    dispatchTextareaInput(ta, text);
    return true;
  }

  function removeAddToBoxButton() {
    document.querySelectorAll('#docdeep-addtobox').forEach((n) => n.remove());
    addBoxBtn = null;
    if (addBoxScheduleTimer) { clearTimeout(addBoxScheduleTimer); addBoxScheduleTimer = 0; }
  }

  // 全局监听只注册一次，常驻但惰性：updateAddToBox 内部按 isOn()/开关值自行短路
  function initAddToBox() {
    if (addBoxListeners.length) return;
    const add = (target, type, handler, capture = false) => {
      target.addEventListener(type, handler, capture);
      addBoxListeners.push({ target, type, handler, capture });
    };
    add(document, 'selectionchange', scheduleAddToBox);
    add(document, 'pointerdown', (e) => {
      if (addBoxBtn && !addBoxBtn.hidden && !addBoxBtn.contains(e.target)) hideAddToBox();
    }, true);
    // 滚动/缩放后选区矩形失效，宁可隐藏，下次选区再浮出
    add(window, 'scroll', hideAddToBox, true);
    add(window, 'resize', hideAddToBox);
  }
