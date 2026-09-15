'use strict';

  // 发送/停止是同一个位置的同一个按钮（生成中会原地变成「停止」）。判定顺序必须是
  // 「先认停止、再认发送」，否则生成中按 Enter 会点中停止按钮，等于把回答打断。
  function composerButtonInfo(button) {
    return {
      el: button,
      type: button.type,
      label: button.getAttribute('aria-label') || '',
      testid: button.getAttribute('data-testid') || '',
      title: button.getAttribute('title') || '',
      disabled: button.disabled === true,
      ariaDisabled: button.getAttribute('aria-disabled'),
    };
  }

  // 发送/停止按钮语义：本地判定。停止优先于发送，避免生成中按 Enter 点到停止。
  function composerButtonKind(info) {
    const text = `${info.label} ${info.testid} ${info.title}`.trim();
    if (text && /停止|中断|interrupt|stop|abort/i.test(text)) return 'stop';
    if (info.type === 'submit' || (text && /发送|send|submit/i.test(text))) return 'send';
    return 'other';
  }

  function composerButtonDisabled(info) {
    return !!(info.disabled || info.ariaDisabled === true || info.ariaDisabled === 'true');
  }

  function composerButtons(ta) {
    const form = ta?.closest?.('form');
    return form ? [...form.querySelectorAll('button')].map(composerButtonInfo) : [];
  }

  function nativeComposerSendButton(ta) {
    const found = composerButtons(ta).find(info => composerButtonKind(info) === 'send');
    return found ? found.el : null;
  }

  // 站点把「Enter 发送 / 生成中 Enter 停止 / IME 与 Shift+Enter 换行」整套语义写在原生 textarea 自身的
  // onKeyDown 上（React 合成事件，监听挂在 React 根容器）。富文本表面挂在 body 下、位于 React 树之外且
  // 不是 textarea 的后代，站点永远收不到它的键盘事件，所以这里把 Enter 以原生事件形式转发给 textarea，
  // 交回站点自己的判定 —— 不再由扩展猜测按钮语义（站点发送按钮是 div[role=button]，既无 aria-label
  // 也无 data-testid，且 composer 没有 form 容器，按钮查找在线上恒为空）。
  // React 的 SyntheticEvent.preventDefault() 会转发到 nativeEvent，故 defaultPrevented 可判定站点是否接管。
  function forwardEnterToNativeComposer(ta) {
    if (!ta || !ta.isConnected || typeof KeyboardEvent !== 'function') return false;
    let event;
    try {
      event = new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, composed: true,
      });
    } catch {
      return false;
    }
    try {
      const notPrevented = ta.dispatchEvent(event);
      return notPrevented === false || event.defaultPrevented === true;
    } catch {
      return false;
    }
  }

  function handleRichInput(binding) {
    const api = richModel();
    if (!api || !binding?.editor || binding.composing) return;
    // 先归位游离内容，再读选区，保证第一次按键后的偏移量就已经落在块内
    ensureRichBlocks(binding.editor);
    clearRichHistory(binding);
    const selection = readRichSelection(binding);
    const pending = binding.pendingMark && binding.pendingStart != null ? {
      mark: binding.pendingMark,
      start: binding.pendingStart,
      desired: binding.pendingValue !== false,
    } : null;
    let model = readRichModel(binding.editor);
    if (pending && selection && selection.end > pending.start) {
      const result = api.setMark(model, pending.start, selection.end, pending.mark, pending.desired);
      if (result.changed) {
        model = result.model;
        renderRichModel(binding.editor, model);
        restoreRichSelection(binding, pending.start, selection.end, 'forward');
      }
      binding.pendingMark = null;
      binding.pendingStart = null;
      binding.pendingValue = null;
    } else if (pending) {
      binding.pendingMark = null;
      binding.pendingStart = null;
      binding.pendingValue = null;
    }
    binding.model = model;
    syncTextareaFromRich(binding, model);
    const nextSelection = readRichSelection(binding);
    if (nextSelection) richSelection = nextSelection;
    updateFormattingToolbarVisibility();
    scheduleRichEditorPosition();
  }

  function applyRichFormatting(binding, kind, savedSelection = null) {
    const api = richModel();
    if (!api || !binding?.editor || !binding.editor.isConnected) return false;
    const selection = savedSelection || readRichSelection(binding) || richSelection;
    if (!selection || selection.editor !== binding.editor) return false;
    const model = readRichModel(binding.editor);
    const result = api.BLOCK_KINDS.has(kind)
      ? api.toggleBlock(model, selection.start, selection.end, kind)
      : api.toggleMark(model, selection.start, selection.end, kind);
    if (!result.changed) {
      if (selection.start === selection.end && ['bold', 'italic', 'strike'].includes(kind)) {
        binding.typingMarks[kind] = result.typingMark === true;
        binding.pendingMark = result.typingMark ? kind : null;
        binding.pendingValue = result.typingMark === true;
        binding.pendingStart = selection.start;
      }
      restoreRichSelection(binding, selection.start, selection.end, selection.direction);
      updateFormattingToolbarVisibility();
      return false;
    }
    const beforeModel = api.normalizeModel(model);
    const beforeSelection = cloneRichSelection(selection);
    binding.model = result.model;
    if (binding.typingMarks) binding.typingMarks[kind] = false;
    renderRichModel(binding.editor, binding.model);
    syncTextareaFromRich(binding, binding.model);
    const afterSelection = {
      start: result.selectionStart,
      end: result.selectionEnd,
      direction: selection.direction,
    };
    recordRichHistory(binding, beforeModel, beforeSelection, api.normalizeModel(binding.model), afterSelection);
    restoreRichSelection(binding, afterSelection.start, afterSelection.end, afterSelection.direction);
    updateFormattingToolbarVisibility();
    scheduleFormattingToolbarPosition();
    return true;
  }

  function positionRichEditor() {
    richEditorPositionScheduled = false;
    const binding = richBinding;
    const editor = binding?.editor;
    const ta = binding?.textarea;
    if (!editor || !ta || !editor.isConnected || !ta.isConnected || !isOn()) return;
    const rect = ta.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      editor.hidden = true;
      return;
    }
    editor.hidden = false;
    // 表面方框相对原生 textarea 两侧各内收 5px；内收量由 CSS 内边距反向补偿（左 14→9、右 12→17），
    // 文字起点不变，与原生输入框对齐。
    const inset = 5;
    editor.style.left = Math.round(rect.left + inset) + 'px';
    editor.style.top = Math.round(rect.top) + 'px';
    editor.style.width = Math.round(rect.width - inset * 2) + 'px';
    editor.style.height = Math.round(rect.height) + 'px';
  }

  function scheduleRichEditorPosition() {
    if (richEditorPositionScheduled) return;
    richEditorPositionScheduled = true;
    const run = () => positionRichEditor();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  function bindRichEditor(binding) {
    const { editor, textarea } = binding;
    const observe = () => {
      if (document.activeElement === editor) {
        const selection = rememberRichSelection(binding);
        if (selection && selection.start !== selection.end) {
          binding.typingMarks = {};
          binding.pendingMark = null;
          binding.pendingStart = null;
          binding.pendingValue = null;
        }
      }
      updateFormattingToolbarVisibility();
      scheduleFormattingToolbarPosition();
    };
    const keydown = (e) => {
      if (e.defaultPrevented || !isOn()) return;
      if (!e.isComposing && e.keyCode !== 229 && (e.ctrlKey || e.metaKey)) {
        const key = String(e.key || '').toLowerCase();
        if (key === 'z') {
          const handled = e.shiftKey ? redoRichHistory(binding) : undoRichHistory(binding);
          if (handled) e.preventDefault();
          return;
        }
        if (key === 'y' && !e.shiftKey) {
          if (redoRichHistory(binding)) e.preventDefault();
          return;
        }
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        syncTextareaFromRich(binding, readRichModel(editor));
        // 主路径：转发给原生 textarea，由站点自身 onKeyDown 决定发送 / 生成中停止 / 空内容提示。
        if (forwardEnterToNativeComposer(textarea)) {
          e.preventDefault();
          return;
        }
        // 回退（站点未接管时）：沿用本地按钮语义；按钮仍取不到就保留编辑器默认换行，不吞键。
        const button = nativeComposerSendButton(textarea);
        if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
        e.preventDefault();
        button.click();
        return;
      }
      const kind = formattingShortcut(e);
      if (!kind) return;
      e.preventDefault();
      const selection = rememberRichSelection(binding) || richSelection;
      if (selection && selection.start !== selection.end) applyRichFormatting(binding, kind, selection);
      else if (selection) applyRichFormatting(binding, kind, selection);
    };
    const beforeinput = (e) => {
      if (!binding.composing && e.inputType === 'historyUndo' && undoRichHistory(binding)) {
        e.preventDefault();
        return;
      }
      if (!binding.composing && e.inputType === 'historyRedo' && redoRichHistory(binding)) {
        e.preventDefault();
        return;
      }
      if (binding.pendingMark && !binding.composing) {
        const selection = readRichSelection(binding);
        if (selection && selection.start === selection.end) binding.pendingStart = selection.start;
      }
      if (binding.typingMarks && !binding.composing) {
        const selection = readRichSelection(binding);
        if (selection && selection.start === selection.end) {
          const active = Object.keys(binding.typingMarks).find((mark) => binding.typingMarks[mark] === true);
          if (active) {
            binding.pendingMark = active;
            binding.pendingValue = true;
            binding.pendingStart = selection.start;
          }
        }
      }
    };
    const input = () => handleRichInput(binding);
    const compositionstart = () => { binding.composing = true; };
    const compositionend = () => { binding.composing = false; handleRichInput(binding); };
    const textareaInput = () => syncRichFromTextarea(binding);
    const events = [
      ['focus', observe], ['keyup', observe], ['mouseup', observe], ['click', observe],
      ['beforeinput', beforeinput], ['input', input], ['compositionstart', compositionstart],
      ['compositionend', compositionend],
    ];
    events.forEach(([type, handler]) => editor.addEventListener(type, handler));
    textarea.addEventListener('input', textareaInput);
    const selectionchange = () => {
      if (document.activeElement === editor) observe();
      else {
        const bar = document.querySelector('#docdeep-formatbar');
        if (!bar || !bar.contains(document.activeElement)) hideFormattingToolbar();
      }
    };
    document.addEventListener('selectionchange', selectionchange, true);
    binding.listeners = events.map(([type, handler]) => ({ target: editor, type, handler }));
    binding.listeners.push({ target: textarea, type: 'input', handler: textareaInput });
    binding.globalListeners = [{ target: document, type: 'selectionchange', handler: selectionchange }];
  }

  function ensureRichEditor(ta) {
    if (!ta || !ta.isConnected || settings.docdeep_format === false) return null;
    if (richBinding?.textarea === ta && richBinding.editor?.isConnected) {
      richBinding.editor.dataset.docdeepPlaceholder = ta.placeholder || '在此继续写作或追问,回车发送…';
      syncRichFromTextarea(richBinding);
      scheduleRichEditorPosition();
      return richBinding.editor;
    }
    removeRichEditor();
    const editor = document.createElement('div');
    editor.id = RICH_EDITOR_ID;
    editor.className = INJECTED;
    editor.contentEditable = 'true';
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-multiline', 'true');
    editor.setAttribute('aria-label', '富文本消息输入框');
    editor.dataset.docdeepPlaceholder = ta.placeholder || '在此继续写作或追问,回车发送…';
    editor.spellcheck = true;
    editor.hidden = true;
    document.body.appendChild(editor);
    ta.setAttribute(RICH_SOURCE_ATTR, '1');
    ta.dataset.docdeepOriginalTabindex = ta.hasAttribute('tabindex')
      ? (ta.getAttribute('tabindex') ?? '')
      : '__docdeep_missing__';
    ta.tabIndex = -1;
    richBinding = { textarea: ta, editor, model: null, lastSerialized: null, syncing: false, composing: false, typingMarks: {}, pendingMark: null, pendingValue: null, pendingStart: null, history: [], historyIndex: 0, historyReplay: false, listeners: [], globalListeners: [] };
    bindRichEditor(richBinding);
    syncRichFromTextarea(richBinding, true);
    scheduleRichEditorPosition();
    return editor;
  }

  function removeRichEditor() {
    if (richBinding) {
      richBinding.listeners?.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
      richBinding.globalListeners?.forEach(({ target, type, handler }) => target.removeEventListener(type, handler, true));
      if (richBinding.textarea?.isConnected) {
        richBinding.textarea.removeAttribute(RICH_SOURCE_ATTR);
        const originalTabindex = richBinding.textarea.dataset.docdeepOriginalTabindex;
        if (originalTabindex !== '__docdeep_missing__' && originalTabindex != null) richBinding.textarea.setAttribute('tabindex', originalTabindex);
        else richBinding.textarea.removeAttribute('tabindex');
        delete richBinding.textarea.dataset.docdeepOriginalTabindex;
      }
      richBinding.editor?.remove();
    }
    document.querySelectorAll('#' + RICH_EDITOR_ID).forEach((node) => node.remove());
    richBinding = null;
    richSelection = null;
    richEditorPositionScheduled = false;
  }
