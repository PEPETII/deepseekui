'use strict';

  // ---- WYSIWYG：本地 contenteditable 表面 + Markdown textarea 底层 ----
  // 不移动原生 textarea；它仍留在原 form 中，仅作为同步/发送底层。可视编辑器是 body 下的固定覆盖层。
  const richModel = () => globalThis.DocDeepRichModel || null;

  function richBlockElements(root) {
    return root ? [...root.children].filter((node) => node.nodeType === 1) : [];
  }

  function richBlockForNode(root, node) {
    if (!root || !node) return null;
    let current = node.nodeType === 1 ? node : node.parentElement;
    while (current && current.parentElement !== root) current = current.parentElement;
    return current && current.parentElement === root ? current : null;
  }

  // 退化修复：contenteditable 被全选删除后浏览器可能留下「零子节点」容器，
  // 或把新输入直接写成裸文本节点（不建块）。此时 richBlockElements 返回空数组，
  // 偏移换算会在 last.childNodes 上抛 undefined，readRichModel 还会把已输入内容当空串丢弃。
  // 统一把游离内容收进一个块，幂等：已有元素子节点即原样返回。
  function ensureRichBlocks(editor) {
    if (!editor || editor.nodeType !== 1) return false;
    if (editor.children.length) return false;
    const loose = Array.from(editor.childNodes);
    const block = document.createElement('div');
    block.className = INJECTED;
    block.dataset.docBlock = '1';
    block.dataset.docBlockKind = 'text';
    if (loose.length) block.append(...loose);
    else block.appendChild(document.createElement('br'));
    editor.appendChild(block);
    return true;
  }

  function richBlockTextLength(block) {
    if (block?.childNodes?.length === 1 && block.firstChild?.nodeType === 1 && block.firstChild.tagName === 'BR') return 0;
    const measure = (node) => {
      if (!node) return 0;
      if (node.nodeType === 3) return String(node.nodeValue || '').replace(/\u200b/g, '').length;
      if (node.nodeType !== 1) return 0;
      if (node.tagName === 'BR') return 1;
      return [...node.childNodes].reduce((n, child) => n + measure(child), 0);
    };
    return measure(block);
  }

  function richBlockBaseOffset(root, block) {
    let total = 0;
    for (const candidate of richBlockElements(root)) {
      if (candidate === block) return total;
      total += richBlockTextLength(candidate) + 1;
    }
    return total;
  }

  function richPointOffset(root, container, offset) {
    const blocks = richBlockElements(root);
    if (!blocks.length) return 0;
    const block = richBlockForNode(root, container);
    if (!block) {
      if (container === root) {
        const childIndex = Math.max(0, Math.min(root.childNodes.length, Number(offset) || 0));
        return Array.from(root.childNodes).slice(0, childIndex).reduce((n, child) => n + richBlockTextLength(child) + 1, 0);
      }
      return 0;
    }
    const measureToPoint = (node) => {
      if (node === container) {
        if (node === block && node.childNodes.length === 1 && node.firstChild?.nodeType === 1 && node.firstChild.tagName === 'BR') return 0;
        if (node.nodeType === 3) return Math.max(0, Math.min(node.nodeValue.length, Number(offset) || 0));
        const childIndex = Math.max(0, Math.min(node.childNodes.length, Number(offset) || 0));
        return Array.from(node.childNodes).slice(0, childIndex).reduce((n, child) => n + measureNode(child), 0);
      }
      return measureNode(node);
    };
    const measureNode = (node) => {
      if (!node) return 0;
      if (node === container) return measureToPoint(node);
      if (node.nodeType === 3) return String(node.nodeValue || '').replace(/\u200b/g, '').length;
      if (node.nodeType !== 1) return 0;
      if (node.tagName === 'BR') return 1;
      return [...node.childNodes].reduce((n, child) => n + measureNode(child), 0);
    };
    try { return richBlockBaseOffset(root, block) + measureNode(block); }
    catch { return richBlockBaseOffset(root, block); }
  }

  function richPointFromNodeOffset(node, remaining) {
    if (!node) return { node: null, offset: 0 };
    if (node.nodeType === 3) return { node, offset: Math.max(0, Math.min(node.nodeValue.length, remaining)) };
    if (node.nodeType !== 1) return { node, offset: node.childNodes?.length || 0 };
    let rest = Math.max(0, remaining);
    for (let index = 0; index < node.childNodes.length; index += 1) {
      const child = node.childNodes[index];
      const length = child.nodeType === 1 && child.tagName === 'BR'
        ? 1
        : child.nodeType === 3
          ? String(child.nodeValue || '').replace(/\u200b/g, '').length
          : richBlockTextLength(child);
      if (child.nodeType === 1 && child.tagName === 'BR') {
        if (rest <= 0) return { node, offset: index };
        if (rest <= 1) return { node, offset: index + 1 };
      } else if (rest <= length) {
        return richPointFromNodeOffset(child, rest);
      }
      rest -= length;
    }
    return { node, offset: node.childNodes.length };
  }

  function richPointFromOffset(root, position) {
    if (!root) return { node: null, offset: 0 };
    const blocks = richBlockElements(root);
    // 空表面/游离内容：没有块可定位，退回容器本身（调用方 setStart 包了 try/catch）
    if (!blocks.length) return { node: root, offset: 0 };
    let remaining = Math.max(0, Number(position) || 0);
    for (let i = 0; i < blocks.length; i += 1) {
      const block = blocks[i];
      const length = richBlockTextLength(block);
      if (remaining <= length || i === blocks.length - 1) {
        return richPointFromNodeOffset(block, remaining);
      }
      remaining -= length + 1;
    }
    const last = blocks[blocks.length - 1];
    return { node: last, offset: last.childNodes.length };
  }

  function richSelectionDirection(selection, range) {
    if (!selection || selection.isCollapsed) return 'none';
    return selection.anchorNode === range.startContainer && selection.anchorOffset === range.startOffset ? 'forward' : 'backward';
  }

  function readRichSelection(binding) {
    const editor = binding?.editor;
    const selection = window.getSelection?.();
    if (!editor || !selection || !selection.rangeCount || !selection.anchorNode || !selection.focusNode) return null;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return null;
    const start = richPointOffset(editor, range.startContainer, range.startOffset);
    const end = richPointOffset(editor, range.endContainer, range.endOffset);
    return {
      editor,
      start: Math.min(start, end),
      end: Math.max(start, end),
      direction: richSelectionDirection(selection, range),
    };
  }

  function rememberRichSelection(binding = richBinding) {
    const selection = readRichSelection(binding);
    if (selection) richSelection = selection;
    return selection;
  }

  function richRangeFromOffsets(editor, start, end) {
    const range = document.createRange();
    const a = richPointFromOffset(editor, start);
    const b = richPointFromOffset(editor, end);
    try {
      range.setStart(a.node, a.offset);
      range.setEnd(b.node, b.offset);
    } catch {
      range.selectNodeContents(editor);
      range.collapse(true);
    }
    return range;
  }

  function restoreRichSelection(binding, start, end, direction = 'none') {
    const editor = binding?.editor;
    if (!editor || !editor.isConnected) return;
    try {
      editor.focus({ preventScroll: true });
    } catch {
      try { editor.focus(); } catch {}
    }
    const range = richRangeFromOffsets(editor, start, end);
    const selection = window.getSelection?.();
    if (!selection) return;
    try {
      selection.removeAllRanges();
      if (direction === 'backward' && !range.collapsed && selection.setBaseAndExtent) {
        selection.setBaseAndExtent(range.endContainer, range.endOffset, range.startContainer, range.startOffset);
      } else {
        selection.addRange(range);
      }
    } catch {}
    richSelection = { editor, start, end, direction };
  }

  function cloneRichSelection(selection) {
    if (!selection) return null;
    return {
      start: Math.max(0, Number(selection.start) || 0),
      end: Math.max(0, Number(selection.end) || 0),
      direction: selection.direction || 'none',
    };
  }

  function clearRichHistory(binding) {
    if (!binding || binding.historyReplay) return;
    binding.history = [];
    binding.historyIndex = 0;
  }

  function recordRichHistory(binding, beforeModel, beforeSelection, afterModel, afterSelection) {
    if (!binding || binding.historyReplay) return;
    binding.history = (binding.history || []).slice(0, binding.historyIndex || 0);
    binding.history.push({
      before: { model: beforeModel, selection: cloneRichSelection(beforeSelection) },
      after: { model: afterModel, selection: cloneRichSelection(afterSelection) },
    });
    if (binding.history.length > 100) binding.history.shift();
    binding.historyIndex = binding.history.length;
  }

  function restoreRichHistorySnapshot(binding, snapshot) {
    const api = richModel();
    if (!api || !binding?.editor || !snapshot) return false;
    binding.historyReplay = true;
    try {
      binding.model = api.normalizeModel(snapshot.model);
      renderRichModel(binding.editor, binding.model);
      syncTextareaFromRich(binding, binding.model);
      const selection = snapshot.selection || { start: 0, end: 0, direction: 'none' };
      restoreRichSelection(binding, selection.start, selection.end, selection.direction);
      updateFormattingToolbarVisibility();
      scheduleFormattingToolbarPosition();
      return true;
    } finally {
      binding.historyReplay = false;
    }
  }

  function undoRichHistory(binding) {
    if (!binding?.historyIndex) return false;
    const entry = binding.history[binding.historyIndex - 1];
    if (!entry || !restoreRichHistorySnapshot(binding, entry.before)) return false;
    binding.historyIndex -= 1;
    return true;
  }

  function redoRichHistory(binding) {
    if (!binding?.history || binding.historyIndex >= binding.history.length) return false;
    const entry = binding.history[binding.historyIndex];
    if (!entry || !restoreRichHistorySnapshot(binding, entry.after)) return false;
    binding.historyIndex += 1;
    return true;
  }

  function richMarksFromElement(node, inherited = {}) {
    const marks = { ...inherited };
    if (!node || node.nodeType !== 1) return marks;
    const tag = node.tagName.toLowerCase();
    if (tag === 'strong' || tag === 'b') marks.bold = true;
    if (tag === 'em' || tag === 'i') marks.italic = true;
    if (tag === 's' || tag === 'del' || tag === 'strike') marks.strike = true;
    if (tag === 'code') marks.code = true;
    if (tag === 'a' && /^(?:https?:|mailto:)/i.test(node.getAttribute('href') || '')) marks.link = node.getAttribute('href');
    const style = node.getAttribute('style') || '';
    if (/font-weight\s*:\s*(?:bold|[6-9]\d\d)/i.test(style)) marks.bold = true;
    if (/font-style\s*:\s*italic/i.test(style)) marks.italic = true;
    return marks;
  }

  function richMarksEqual(a = {}, b = {}) {
    return ['bold', 'italic', 'strike', 'code', 'link']
      .every((key) => String(a[key] || '') === String(b[key] || ''));
  }

  function pushRichDomRun(runs, text, marks) {
    const value = String(text || '').replace(/\u200b/g, '');
    if (!value) return;
    const previous = runs[runs.length - 1];
    if (previous && richMarksEqual(previous.marks, marks)) {
      previous.text += value;
      return;
    }
    runs.push({ text: value, marks: { ...marks } });
  }

  function readRichInline(node, runs, marks = {}) {
    if (!node) return;
    if (node.nodeType === 3) {
      pushRichDomRun(runs, node.nodeValue, marks);
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.tagName === 'BR') {
      pushRichDomRun(runs, '\n', marks);
      return;
    }
    const nextMarks = richMarksFromElement(node, marks);
    [...node.childNodes].forEach((child) => readRichInline(child, runs, nextMarks));
  }

  function readRichModel(editor) {
    const api = richModel();
    if (!api) return { blocks: [{ kind: 'text', runs: [] }] };
    ensureRichBlocks(editor);
    const blocks = richBlockElements(editor).map((block) => {
      const tag = block.tagName.toLowerCase();
      const markedKind = block.dataset.docBlockKind;
      const kind = api.BLOCK_KINDS.has(markedKind) ? markedKind
        : /^h[1-3]$/.test(tag) ? tag : 'text';
      const runs = [];
      const children = [...block.childNodes];
      if (!(children.length === 1 && children[0].nodeType === 1 && children[0].tagName === 'BR')) {
        children.forEach((child) => readRichInline(child, runs));
      }
      return { kind, runs };
    });
    return api.normalizeModel({ blocks: blocks.length ? blocks : [{ kind: 'text', runs: [] }] });
  }

  function createRichInline(run) {
    let node = document.createTextNode(String(run.text || ''));
    const marks = run.marks || {};
    if (marks.link) {
      const link = document.createElement('a');
      link.href = String(marks.link);
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      link.appendChild(node);
      node = link;
    }
    if (marks.code) {
      const code = document.createElement('code');
      code.appendChild(node);
      node = code;
    }
    if (marks.strike) {
      const strike = document.createElement('s');
      strike.appendChild(node);
      node = strike;
    }
    if (marks.italic) {
      const italic = document.createElement('em');
      italic.appendChild(node);
      node = italic;
    }
    if (marks.bold) {
      const bold = document.createElement('strong');
      bold.appendChild(node);
      node = bold;
    }
    return node;
  }

  function renderRichModel(editor, model) {
    const api = richModel();
    if (!editor || !api) return;
    const normalized = api.normalizeModel(model);
    const fragment = document.createDocumentFragment();
    normalized.blocks.forEach((blockData) => {
      const block = document.createElement('div');
      block.className = INJECTED;
      block.dataset.docBlock = '1';
      block.dataset.docBlockKind = blockData.kind;
      blockData.runs.forEach((run) => block.appendChild(createRichInline(run)));
      if (!blockData.runs.length) block.appendChild(document.createElement('br'));
      fragment.appendChild(block);
    });
    editor.replaceChildren(fragment);
    editor.dataset.docdeepEmpty = api.serializeMarkdown(normalized) ? 'false' : 'true';
  }

  function syncTextareaFromRich(binding, model = null) {
    const api = richModel();
    const ta = binding?.textarea;
    if (!api || !ta || !ta.isConnected) return '';
    // React 把受控值追踪挂在元素实例的 value setter 上：直接 `ta.value = v` 会同步刷新 tracker，
    // 紧随其后的 input 事件会被判定为「值未变」而不触发 onChange，站点的受控状态便收不到我们写入的内容。
    // 改走平台原型上的原生 setter 绕过实例包装，与站点自身写值手法一致。
    const writeTextareaValue = (node, next) => {
      const descriptor = typeof HTMLTextAreaElement === 'function'
        ? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
        : null;
      const setter = descriptor && descriptor.set;
      if (typeof setter === 'function') {
        try {
          setter.call(node, next);
          return;
        } catch {
          // 落到直赋兜底
        }
      }
      node.value = next;
    };
    const value = api.serializeMarkdown(model || binding.model || readRichModel(binding.editor));
    // 空态标记必须随每次同步刷新：普通打字只走 handleRichInput，不经过 renderRichModel，
    // 若只在那里更新 data-docdeep-empty，占位符伪元素会在有文字后仍然显示。
    if (binding.editor?.isConnected) binding.editor.dataset.docdeepEmpty = value ? 'false' : 'true';
    if (value === ta.value) {
      binding.lastSerialized = value;
      return value;
    }
    binding.syncing = true;
    try {
      writeTextareaValue(ta, value);
      dispatchTextareaInput(ta, value);
    } finally {
      binding.syncing = false;
    }
    binding.lastSerialized = value;
    return value;
  }

  function syncRichFromTextarea(binding, force = false) {
    const api = richModel();
    const ta = binding?.textarea;
    if (!api || !ta || !binding.editor || binding.syncing || !ta.isConnected) return;
    const value = String(ta.value || '');
    if (!force && value === binding.lastSerialized) return;
    clearRichHistory(binding);
    const selection = document.activeElement === binding.editor ? readRichSelection(binding) : null;
    binding.model = api.parseMarkdown(value);
    binding.lastSerialized = value;
    renderRichModel(binding.editor, binding.model);
    if (selection) restoreRichSelection(binding, Math.min(selection.start, api.modelTextLength(binding.model)), Math.min(selection.end, api.modelTextLength(binding.model)), selection.direction);
    scheduleRichEditorPosition();
  }