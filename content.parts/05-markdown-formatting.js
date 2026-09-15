'use strict';

  // Phase-6 Markdown 编辑：textarea 仍作为未启用富文本时的兼容回退路径。
  // 纯函数入口同时作为行为测试边界：不读 DOM、不触碰发送链路。
  function formatMarkdownValue(value, start, end, kind, direction = 'none') {
    const source = String(value ?? '');
    const limit = source.length;
    const safeStart = Math.max(0, Math.min(limit, Number.isFinite(start) ? start : 0));
    const safeEnd = Math.max(safeStart, Math.min(limit, Number.isFinite(end) ? end : safeStart));
    const unchanged = () => ({
      value: source,
      selectionStart: safeStart,
      selectionEnd: safeEnd,
      direction: direction || 'none',
      changed: false,
    });

    const marker = kind === 'bold' ? '**' : kind === 'italic' ? '*' : '';
    if (marker) {
      if (safeStart === safeEnd) {
        const replacement = marker + marker;
        const next = source.slice(0, safeStart) + replacement + source.slice(safeEnd);
        const caret = safeStart + marker.length;
        return {
          value: next,
          selectionStart: caret,
          selectionEnd: caret,
          direction: 'none',
          replaceStart: safeStart,
          replaceEnd: safeEnd,
          replacement,
          changed: next !== source,
        };
      }
      const selected = source.slice(safeStart, safeEnd);
      const markerLen = marker.length;
      let replaceStart = safeStart;
      let replaceEnd = safeEnd;
      let replacement = marker + selected + marker;
      let nextStart = safeStart;
      let nextEnd = safeEnd + markerLen * 2;
      if (selected.length >= markerLen * 2
        && selected.startsWith(marker)
        && selected.endsWith(marker)) {
        replaceStart = safeStart;
        replaceEnd = safeEnd;
        replacement = selected.slice(markerLen, -markerLen);
        nextStart = safeStart;
        nextEnd = safeStart + replacement.length;
      } else if (safeStart >= markerLen
        && source.slice(safeStart - markerLen, safeStart) === marker
        && source.slice(safeEnd, safeEnd + markerLen) === marker) {
        replaceStart = safeStart - markerLen;
        replaceEnd = safeEnd + markerLen;
        replacement = selected;
        nextStart = replaceStart;
        nextEnd = replaceStart + replacement.length;
      }
      const next = source.slice(0, replaceStart) + replacement + source.slice(replaceEnd);
      return {
        value: next,
        selectionStart: nextStart,
        selectionEnd: nextEnd,
        direction: direction || 'none',
        replaceStart,
        replaceEnd,
        replacement,
        changed: next !== source,
      };
    }

    const blockKinds = new Set(['text', 'h1', 'h2', 'h3', 'ordered', 'unordered']);
    if (!blockKinds.has(kind)) return unchanged();
    const lineStartAt = (text, position) => {
      const newline = text.lastIndexOf('\n', Math.max(0, position - 1));
      return newline + 1;
    };
    const lineEndAt = (text, position) => {
      const newline = text.indexOf('\n', Math.max(0, position));
      return newline < 0 ? text.length : newline;
    };
    const parsePrefix = (line) => {
      const heading = line.match(/^[ \t]*#{1,3}(?:[ \t]+|$)/);
      if (heading) {
        return { kind: 'h' + heading[0].trim().length, prefix: heading[0], rest: line.slice(heading[0].length) };
      }
      const ordered = line.match(/^[ \t]*\d+[.)][ \t]+/);
      if (ordered) return { kind: 'ordered', prefix: ordered[0], rest: line.slice(ordered[0].length) };
      const unordered = line.match(/^[ \t]*[-+*][ \t]+/);
      if (unordered) return { kind: 'unordered', prefix: unordered[0], rest: line.slice(unordered[0].length) };
      return { kind: 'text', prefix: '', rest: line };
    };
    const desiredPrefix = {
      h1: '# ',
      h2: '## ',
      h3: '### ',
      ordered: '1. ',
      unordered: '- ',
    }[kind] || '';
    const noSelection = safeStart === safeEnd;
    const blockStart = lineStartAt(source, safeStart);
    const endProbe = safeEnd > safeStart && source[safeEnd - 1] === '\n' ? safeEnd - 1 : safeEnd;
    const blockEnd = lineEndAt(source, endProbe);
    const oldBlock = source.slice(blockStart, blockEnd);
    const oldLines = oldBlock.split('\n');
    const parsedLines = oldLines.map(parsePrefix);
    const nonEmpty = parsedLines.filter((info) => info.rest.trim() !== '');
    const allDesired = kind !== 'text'
      && nonEmpty.length > 0
      && nonEmpty.every((info) => info.kind === kind);
    const outputKind = allDesired ? 'text' : kind;
    const transformLine = (line) => {
      const info = parsePrefix(line);
      if (!info.rest.trim() && noSelection) return outputKind === 'text' ? '' : desiredPrefix;
      if (!info.rest.trim()) return '';
      return outputKind === 'text' ? info.rest : desiredPrefix + info.rest;
    };
    const newBlock = oldLines.map(transformLine).join('\n');
    const next = source.slice(0, blockStart) + newBlock + source.slice(blockEnd);
    if (!next || next === source) {
      if (next === source) return unchanged();
    }
    if (noSelection) {
      const info = parsedLines[0] || { prefix: '', rest: '' };
      const oldOffset = safeStart - blockStart;
      const contentOffset = oldOffset <= info.prefix.length
        ? 0
        : Math.min(oldOffset - info.prefix.length, info.rest.length);
      const newOffset = outputKind === 'text'
        ? Math.min(contentOffset, newBlock.length)
        : Math.min(desiredPrefix.length + contentOffset, newBlock.length);
      const caret = blockStart + newOffset;
      return {
        value: next,
        selectionStart: caret,
        selectionEnd: caret,
        direction: 'none',
        replaceStart: blockStart,
        replaceEnd: blockEnd,
        replacement: newBlock,
        changed: next !== source,
      };
    }
    return {
      value: next,
      selectionStart: blockStart,
      selectionEnd: blockStart + newBlock.length,
      direction: direction || 'none',
      replaceStart: blockStart,
      replaceEnd: blockEnd,
      replacement: newBlock,
      changed: next !== source,
    };
  }

  function nativeComposerTextarea() {
    const candidates = [...document.querySelectorAll('textarea:not(.' + INJECTED + ')')];
    return candidates.find((ta) => ta.closest('form')) || candidates[0] || null;
  }

  function rememberFormattingSelection(ta) {
    const selection = readFormattingSelection(ta);
    if (selection) formatSelection = selection;
  }

  function readFormattingSelection(ta) {
    if (!ta || !Number.isFinite(ta.selectionStart) || !Number.isFinite(ta.selectionEnd)) return null;
    const valueLength = String(ta.value || '').length;
    const start = Math.max(0, Math.min(valueLength, ta.selectionStart));
    const end = Math.max(start, Math.min(valueLength, ta.selectionEnd));
    return {
      textarea: ta,
      start,
      end,
      direction: ta.selectionDirection || 'none',
    };
  }

  function readNonEmptyFormattingSelection(ta) {
    const selection = readFormattingSelection(ta);
    return selection && selection.start !== selection.end ? selection : null;
  }

  function currentFormattingSelection(ta) {
    if (document.activeElement !== ta && formatSelection?.textarea === ta) return formatSelection;
    rememberFormattingSelection(ta);
    return formatSelection || { textarea: ta, start: 0, end: 0, direction: 'none' };
  }

  function dispatchTextareaInput(ta, data) {
    try {
      ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data }));
    } catch {
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function focusAndSelectTextarea(ta, start, end, direction) {
    try { ta.focus({ preventScroll: true }); } catch { ta.focus(); }
    try { ta.setSelectionRange(start, end, direction || 'none'); } catch {}
  }

  function applyMarkdownToTextarea(ta, kind, savedSelection = null) {
    if (!ta || !ta.isConnected || typeof ta.value !== 'string') return false;
    const selection = savedSelection || currentFormattingSelection(ta);
    const result = formatMarkdownValue(ta.value, selection.start, selection.end, kind, selection.direction);
    if (!result.changed) {
      focusAndSelectTextarea(ta, result.selectionStart, result.selectionEnd, result.direction);
      rememberFormattingSelection(ta);
      return false;
    }
    if (typeof ta.setRangeText === 'function') {
      ta.setRangeText(result.replacement, result.replaceStart, result.replaceEnd, 'preserve');
    } else {
      ta.value = result.value;
    }
    focusAndSelectTextarea(ta, result.selectionStart, result.selectionEnd, result.direction);
    dispatchTextareaInput(ta, result.value.slice(result.selectionStart, result.selectionEnd));
    // 页面框架的 input 监听可能同步回写 value，再确认一次原生选区。
    focusAndSelectTextarea(ta, result.selectionStart, result.selectionEnd, result.direction);
    rememberFormattingSelection(ta);
    return true;
  }

  function formattingShortcut(e) {
    if (!(e.ctrlKey || e.metaKey) || e.isComposing || e.keyCode === 229 || e.shiftKey) return null;
    const key = String(e.key || '').toLowerCase();
    if (e.altKey && ['0', '1', '2', '3'].includes(key)) return ({ 0: 'text', 1: 'h1', 2: 'h2', 3: 'h3' })[key];
    if (!e.altKey && key === 'b') return 'bold';
    if (!e.altKey && key === 'i') return 'italic';
    return null;
  }

  function hideFormattingToolbar() {
    const bar = document.querySelector('#docdeep-formatbar');
    if (bar) bar.hidden = true;
  }

  function nonEmptyRichToolbarSelection(rich, bar) {
    const live = readRichSelection(richBinding);
    if (live) richSelection = live;
    if (live && live.start !== live.end) return live;
    // 仅在点击工具栏导致编辑器暂时失焦时，沿用上一次真实非空选区。
    if (bar && bar.contains(document.activeElement)
      && richSelection?.editor === rich
      && richSelection.start !== richSelection.end) {
      return richSelection;
    }
    return null;
  }

  function updateFormattingToolbarVisibility() {
    const bar = document.querySelector('#docdeep-formatbar');
    const rich = richBinding?.editor;
    if (rich && rich.isConnected) {
      if (!bar || !isOn() || settings.docdeep_format === false) {
        if (bar) bar.hidden = true;
        return;
      }
      if (document.activeElement !== rich && !bar.contains(document.activeElement)) {
        bar.hidden = true;
        return;
      }
      const selection = nonEmptyRichToolbarSelection(rich, bar);
      if (!selection) {
        bar.hidden = true;
        return;
      }
      bar.hidden = false;
      scheduleFormattingToolbarPosition();
      return;
    }
    const ta = formatBinding?.textarea;
    if (!bar || !ta || !ta.isConnected || !isOn() || settings.docdeep_format === false) {
      if (bar) bar.hidden = true;
      return;
    }
    if (document.activeElement !== ta && !bar.contains(document.activeElement)) {
      bar.hidden = true;
      return;
    }
    const selection = readNonEmptyFormattingSelection(ta);
    if (!selection) {
      bar.hidden = true;
      return;
    }
    formatSelection = selection;
    bar.hidden = false;
    scheduleFormattingToolbarPosition();
  }

  function bindFormattingTextarea(ta) {
    if (formatBinding?.textarea === ta) return;
    unbindFormattingTextarea();
    const observe = () => {
      if (document.activeElement === ta) rememberFormattingSelection(ta);
      updateFormattingToolbarVisibility();
    };
    const keydown = (e) => {
      if (e.defaultPrevented || !isOn()) return;
      const kind = formattingShortcut(e);
      if (!kind) return;
      e.preventDefault();
      applyMarkdownToTextarea(ta, kind);
    };
    const blur = (e) => {
      const bar = document.querySelector('#docdeep-formatbar');
      if (bar && e.relatedTarget && bar.contains(e.relatedTarget)) return;
      if (e.relatedTarget) {
        hideFormattingToolbar();
        return;
      }
      setTimeout(() => {
        const currentBar = document.querySelector('#docdeep-formatbar');
        if (currentBar && currentBar.contains(document.activeElement)) return;
        if (document.activeElement === ta && readNonEmptyFormattingSelection(ta)) {
          updateFormattingToolbarVisibility();
          return;
        }
        hideFormattingToolbar();
      }, 0);
    };
    const selectionchange = () => {
      if (document.activeElement === ta) observe();
      else {
        const bar = document.querySelector('#docdeep-formatbar');
        if (!bar || !bar.contains(document.activeElement)) hideFormattingToolbar();
      }
    };
    const pagePointer = (e) => {
      const bar = document.querySelector('#docdeep-formatbar');
      if (!bar || bar.hidden) return;
      if (bar.contains(e.target) || e.target === ta) return;
      hideFormattingToolbar();
    };
    const events = ['focus', 'select', 'keyup', 'mouseup', 'click', 'input', 'compositionend'];
    const listeners = events.map((type) => {
      ta.addEventListener(type, observe);
      return { type, handler: observe };
    });
    ta.addEventListener('blur', blur);
    listeners.push({ type: 'blur', handler: blur });
    ta.addEventListener('keydown', keydown);
    listeners.push({ type: 'keydown', handler: keydown });
    const globalListeners = [
      { target: document, type: 'selectionchange', handler: selectionchange },
      { target: document, type: 'pointerdown', handler: pagePointer },
    ];
    globalListeners.forEach(({ target, type, handler }) => target.addEventListener(type, handler, true));
    formatBinding = { textarea: ta, listeners, globalListeners };
    formatSelection = null;
    hideFormattingToolbar();
  }

  function unbindFormattingTextarea() {
    if (!formatBinding) return;
    formatBinding.listeners.forEach(({ type, handler }) => formatBinding.textarea.removeEventListener(type, handler));
    formatBinding.globalListeners.forEach(({ target, type, handler }) => target.removeEventListener(type, handler, true));
    formatBinding = null;
  }

  function removeFormattingToolbar() {
    unbindFormattingTextarea();
    formatSelection = null;
    removeRichEditor();
    document.querySelectorAll('#docdeep-formatbar').forEach((n) => n.remove());
  }

  function makeFormattingButton(label, title, kind, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'doc-format-btn ' + INJECTED + (className ? ' ' + className : '');
    button.textContent = label;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        rememberFormattingSelection(formatBinding?.textarea);
        rememberRichSelection(richBinding);
        e.preventDefault();
      }
    });
    button.addEventListener('click', () => {
      if (richBinding?.editor?.isConnected) {
        applyRichFormatting(richBinding, kind, richSelection?.editor === richBinding.editor ? richSelection : null);
        return;
      }
      const ta = formatBinding?.textarea || nativeComposerTextarea();
      if (ta) applyMarkdownToTextarea(ta, kind, formatSelection?.textarea === ta ? formatSelection : null);
    });
    return button;
  }

  function ensureFormattingToolbar() {
    const ta = nativeComposerTextarea();
    let bar = document.querySelector('#docdeep-formatbar');
    if (settings.docdeep_format === false || !ta) {
      if (bar || richBinding) removeFormattingToolbar();
      return;
    }
    ensureRichEditor(ta);
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'docdeep-formatbar';
      bar.className = INJECTED;
      bar.hidden = true;
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', '富文本格式工具栏');
      bar.append(
        makeFormattingButton('B', '加粗 (Ctrl/Cmd+B)', 'bold', 'doc-format-btn--strong'),
        makeFormattingButton('I', '斜体 (Ctrl/Cmd+I)', 'italic', 'doc-format-btn--em'),
      );
      const divider = document.createElement('span');
      divider.className = 'doc-format-divider ' + INJECTED;
      divider.setAttribute('aria-hidden', 'true');
      bar.appendChild(divider);
      const select = document.createElement('select');
      select.className = 'doc-format-select ' + INJECTED;
      select.setAttribute('aria-label', '文本类型');
      select.title = '文本类型 (Ctrl/Cmd+Alt+0/1/2/3)';
      [
        ['text', '文本'],
        ['h1', '标题1'],
        ['h2', '标题2'],
        ['h3', '标题3'],
        ['ordered', '编号列表'],
        ['unordered', '项目符号列表'],
      ].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
      });
      select.addEventListener('mousedown', () => {
        rememberFormattingSelection(formatBinding?.textarea);
        rememberRichSelection(richBinding);
      });
      select.addEventListener('change', () => {
        if (richBinding?.editor?.isConnected) {
          applyRichFormatting(richBinding, select.value, richSelection?.editor === richBinding.editor ? richSelection : null);
          return;
        }
        const current = formatBinding?.textarea || nativeComposerTextarea();
        if (current) applyMarkdownToTextarea(current, select.value, formatSelection?.textarea === current ? formatSelection : null);
      });
      bar.appendChild(select);
      document.body.appendChild(bar);
    }
    bindFormattingTextarea(ta);
    updateFormattingToolbarVisibility();
  }

  function formattingAnchorRect(ta, selection) {
    const rect = ta.getBoundingClientRect();
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(ta) : null;
    const paddingLeft = parseFloat(style?.paddingLeft) || 8;
    const paddingRight = parseFloat(style?.paddingRight) || 8;
    const paddingTop = parseFloat(style?.paddingTop) || 8;
    const fontSize = parseFloat(style?.fontSize) || 15;
    const lineHeightValue = parseFloat(style?.lineHeight);
    const lineHeight = Number.isFinite(lineHeightValue) && lineHeightValue > 0 ? lineHeightValue : fontSize * 1.4;
    const before = String(ta.value || '').slice(0, selection.start);
    const lines = before.split('\n');
    const currentLine = lines[lines.length - 1] || '';
    const averageCharWidth = /[\u2e80-\u9fff]/.test(currentLine) ? fontSize : fontSize * 0.55;
    const contentWidth = Math.max(1, (rect.width || ta.clientWidth || 360) - paddingLeft - paddingRight);
    let visualLine = 0;
    for (let i = 0; i < lines.length - 1; i += 1) {
      visualLine += Math.max(1, Math.ceil((lines[i].length * averageCharWidth + 1) / contentWidth));
    }
    visualLine += Math.floor((currentLine.length * averageCharWidth) / contentWidth);
    const lineOffset = (currentLine.length * averageCharWidth) % contentWidth;
    const left = rect.left + paddingLeft + lineOffset - (ta.scrollLeft || 0);
    const top = rect.top + paddingTop + visualLine * lineHeight - (ta.scrollTop || 0);
    const width = Math.max(averageCharWidth, Math.min(contentWidth - lineOffset, (selection.end - selection.start) * averageCharWidth));
    return { left, top, right: left + width, bottom: top + lineHeight };
  }

  function positionFormattingToolbar() {
    formatToolbarPositionScheduled = false;
    const bar = document.querySelector('#docdeep-formatbar');
    const rich = richBinding?.editor;
    if (bar && rich && rich.isConnected && isOn()) {
      const selection = nonEmptyRichToolbarSelection(rich, bar);
      if (!selection || (document.activeElement !== rich && !bar.contains(document.activeElement))) {
        bar.hidden = true;
        return;
      }
      const editorRect = rich.getBoundingClientRect();
      const selectionRect = richRangeFromOffsets(rich, selection.start, selection.end).getBoundingClientRect();
      const anchor = (selectionRect.width || selectionRect.height)
        ? selectionRect
        : editorRect;
      bar.hidden = false;
      const barRect = bar.getBoundingClientRect();
      const gap = 8;
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth || editorRect.right;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight || editorRect.bottom;
      const left = Math.max(8, Math.min(anchor.left + (anchor.right - anchor.left) / 2 - barRect.width / 2, viewportWidth - barRect.width - 8));
      let top = anchor.top - barRect.height - gap;
      if (top < 8) top = anchor.bottom + gap;
      if (top + barRect.height > viewportHeight - 8) top = Math.max(8, viewportHeight - barRect.height - 8);
      bar.style.left = Math.round(left) + 'px';
      bar.style.top = Math.round(top) + 'px';
      return;
    }
    const ta = formatBinding?.textarea;
    if (!bar || !ta || !ta.isConnected || !isOn()
      || (document.activeElement !== ta && !bar.contains(document.activeElement))) {
      if (bar) bar.hidden = true;
      return;
    }
    const rect = ta.getBoundingClientRect();
    const selection = formatSelection?.textarea === ta && formatSelection.start !== formatSelection.end
      ? formatSelection
      : readNonEmptyFormattingSelection(ta);
    if ((!rect.width && !rect.height) || !selection) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const anchor = formattingAnchorRect(ta, selection);
    const barRect = bar.getBoundingClientRect();
    const gap = 8;
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth || rect.right;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight || rect.bottom;
    const left = Math.max(8, Math.min(anchor.left + (anchor.right - anchor.left) / 2 - barRect.width / 2, viewportWidth - barRect.width - 8));
    let top = anchor.top - barRect.height - gap;
    if (top < 8) top = anchor.bottom + gap;
    if (top + barRect.height > viewportHeight - 8) top = Math.max(8, viewportHeight - barRect.height - 8);
    bar.style.left = Math.round(left) + 'px';
    bar.style.top = Math.round(top) + 'px';
  }

  function scheduleFormattingToolbarPosition() {
    if (formatToolbarPositionScheduled) return;
    formatToolbarPositionScheduled = true;
    const run = () => positionFormattingToolbar();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
  }
