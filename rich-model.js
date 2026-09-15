/* deepseek ui - 本地富文本模型
 * 无 DOM / 无网络 / 无第三方依赖；供 content.parts 的富文本表面与 Node 测试共用。
 * 模型以 block + inline runs 表示，textarea 仍保存 Markdown。
 */
(() => {
  'use strict';

  const BLOCK_KINDS = new Set(['text', 'h1', 'h2', 'h3', 'ordered', 'unordered']);
  const MARK_KEYS = ['bold', 'italic', 'strike', 'code', 'link'];

  function cloneMarks(marks = {}) {
    const next = {};
    MARK_KEYS.forEach((key) => {
      if (marks[key]) next[key] = key === 'link' ? String(marks[key]) : true;
    });
    return next;
  }

  function sameMarks(a = {}, b = {}) {
    return MARK_KEYS.every((key) => String(a[key] || '') === String(b[key] || ''));
  }

  function pushRun(runs, text, marks = {}) {
    const value = String(text ?? '');
    if (!value) return;
    const normalized = cloneMarks(marks);
    const previous = runs[runs.length - 1];
    if (previous && sameMarks(previous.marks, normalized)) previous.text += value;
    else runs.push({ text: value, marks: normalized });
  }

  function normalizeRuns(runs) {
    const output = [];
    (Array.isArray(runs) ? runs : []).forEach((run) => {
      pushRun(output, run?.text, run?.marks);
    });
    return output;
  }

  function normalizeModel(model) {
    const blocks = Array.isArray(model?.blocks) ? model.blocks : [];
    return {
      blocks: blocks.length
        ? blocks.map((block) => ({
          kind: BLOCK_KINDS.has(block?.kind) ? block.kind : 'text',
          runs: normalizeRuns(block?.runs),
        }))
        : [{ kind: 'text', runs: [] }],
    };
  }

  function findClosing(source, marker, start) {
    let at = Math.max(0, start);
    while (at < source.length) {
      at = source.indexOf(marker, at);
      if (at < 0) return -1;
      if (at !== 0 && source[at - 1] === '\\') {
        at += marker.length;
        continue;
      }
      if (marker === '**' && source.slice(at, at + 3) === '***') return at + 1;
      if (marker === '*' && source.slice(at, at + 3) === '***') return at + 2;
      if (marker === '*' && source.slice(at, at + 2) === '**') {
        at += 2;
        continue;
      }
      return at;
    }
    return -1;
  }

  function parseInline(source, inherited = {}) {
    const input = String(source ?? '');
    const runs = [];
    let plain = '';
    const flush = () => {
      if (plain) {
        pushRun(runs, plain, inherited);
        plain = '';
      }
    };
    for (let i = 0; i < input.length;) {
      if (input[i] === '\\' && i + 1 < input.length) {
        plain += input[i + 1];
        i += 2;
        continue;
      }
      if (input[i] === '[') {
        const closeLabel = findClosing(input, ']', i + 1);
        const openHref = closeLabel >= 0 && input[closeLabel + 1] === '(' ? closeLabel + 2 : -1;
        const closeHref = openHref >= 0 ? findClosing(input, ')', openHref) : -1;
        if (closeLabel > i && closeHref > openHref) {
          const href = input.slice(openHref, closeHref).trim();
          if (/^(?:https?:|mailto:)/i.test(href)) {
            flush();
            parseInline(input.slice(i + 1, closeLabel), { ...inherited, link: href }).forEach((run) => {
              pushRun(runs, run.text, run.marks);
            });
            i = closeHref + 1;
            continue;
          }
        }
      }
      if (input[i] === '`') {
        const close = findClosing(input, '`', i + 1);
        if (close > i + 1) {
          flush();
          pushRun(runs, input.slice(i + 1, close), { ...inherited, code: true });
          i = close + 1;
          continue;
        }
      }
      const pairs = [
        ['***', { bold: true, italic: true }],
        ['**', { bold: true }],
        ['~~', { strike: true }],
        ['*', { italic: true }],
      ];
      let consumed = false;
      for (const [marker, marks] of pairs) {
        if (!input.startsWith(marker, i)) continue;
        if (marker === '*' && input[i + 1] === '*') continue;
        const close = findClosing(input, marker, i + marker.length);
        if (close <= i + marker.length) continue;
        flush();
        parseInline(input.slice(i + marker.length, close), { ...inherited, ...marks }).forEach((run) => {
          pushRun(runs, run.text, run.marks);
        });
        i = close + marker.length;
        consumed = true;
        break;
      }
      if (consumed) continue;
      plain += input[i];
      i += 1;
    }
    flush();
    return runs;
  }

  function parseMarkdown(value) {
    const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
    return normalizeModel({
      blocks: lines.map((line) => {
        let match = line.match(/^[ \t]*(#{1,3})(?:[ \t]+|$)(.*)$/);
        if (match) return { kind: 'h' + match[1].length, runs: parseInline(match[2]) };
        match = line.match(/^[ \t]*\d+[.)][ \t]+(.*)$/);
        if (match) return { kind: 'ordered', runs: parseInline(match[1]) };
        match = line.match(/^[ \t]*[-+*][ \t]+(.*)$/);
        if (match) return { kind: 'unordered', runs: parseInline(match[1]) };
        return { kind: 'text', runs: parseInline(line) };
      }),
    });
  }

  function escapePlain(text) {
    return String(text ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/([*~`_[\]])/g, '\\$1');
  }

  function serializeInline(runs) {
    const normalized = normalizeRuns(runs);
    const atomic = (run) => {
      const marks = run.marks || {};
      if (marks.code) return '`' + String(run.text).replace(/`/g, '\\`') + '`';
      let value = escapePlain(run.text);
      if (marks.link) value = '[' + value + '](' + String(marks.link) + ')';
      return value;
    };
    const wrappers = { bold: ['**', '**'], italic: ['*', '*'], strike: ['~~', '~~'] };
    const render = (items) => {
      let output = '';
      for (let i = 0; i < items.length;) {
        const run = items[i];
        const marks = run.marks || {};
        const mark = ['bold', 'italic', 'strike'].find((key) => marks[key] && !marks.code);
        if (!mark) {
          output += atomic(run);
          i += 1;
          continue;
        }
        let end = i + 1;
        while (end < items.length && items[end].marks?.[mark] && !items[end].marks?.code) end += 1;
        const inner = items.slice(i, end).map((item) => ({
          text: item.text,
          marks: { ...item.marks, [mark]: false },
        }));
        output += wrappers[mark][0] + render(inner) + wrappers[mark][1];
        i = end;
      }
      return output;
    };
    return render(normalized);
  }

  function serializeMarkdown(model) {
    const normalized = normalizeModel(model);
    return normalized.blocks.map((block) => {
      const value = serializeInline(block.runs);
      if (block.kind === 'h1') return '# ' + value;
      if (block.kind === 'h2') return '## ' + value;
      if (block.kind === 'h3') return '### ' + value;
      if (block.kind === 'ordered') return '1. ' + value;
      if (block.kind === 'unordered') return '- ' + value;
      return value;
    }).join('\n');
  }

  function modelTextLength(model) {
    const normalized = normalizeModel(model);
    return normalized.blocks.reduce((total, block, index) => {
      const blockLength = block.runs.reduce((n, run) => n + String(run.text || '').length, 0);
      return total + blockLength + (index < normalized.blocks.length - 1 ? 1 : 0);
    }, 0);
  }

  function marksAt(model, position) {
    const normalized = normalizeModel(model);
    let cursor = 0;
    for (let i = 0; i < normalized.blocks.length; i += 1) {
      const block = normalized.blocks[i];
      for (const run of block.runs) {
        const end = cursor + run.text.length;
        if (position >= cursor && position <= end && run.text.length) return cloneMarks(run.marks);
        cursor = end;
      }
      if (i < normalized.blocks.length - 1) cursor += 1;
    }
    return {};
  }

  function splitRun(run, start, end) {
    const text = String(run.text || '');
    const pieces = [];
    if (start > 0) pieces.push({ text: text.slice(0, start), marks: cloneMarks(run.marks) });
    if (end > start) pieces.push({ text: text.slice(start, end), marks: cloneMarks(run.marks) });
    if (end < text.length) pieces.push({ text: text.slice(end), marks: cloneMarks(run.marks) });
    return pieces;
  }

  function setMark(model, start, end, mark, desired) {
    const normalized = normalizeModel(model);
    const limit = modelTextLength(normalized);
    const safeStart = Math.max(0, Math.min(limit, Number.isFinite(start) ? start : 0));
    const safeEnd = Math.max(safeStart, Math.min(limit, Number.isFinite(end) ? end : safeStart));
    if (!['bold', 'italic', 'strike'].includes(mark)) {
      return { model: normalized, selectionStart: safeStart, selectionEnd: safeEnd, changed: false };
    }
    if (safeStart === safeEnd) return { model: normalized, selectionStart: safeStart, selectionEnd: safeEnd, changed: false };
    let cursor = 0;
    let changed = false;
    normalized.blocks.forEach((block, blockIndex) => {
      const nextRuns = [];
      block.runs.forEach((run) => {
        const runStart = cursor;
        const runEnd = cursor + run.text.length;
        const localStart = Math.max(0, safeStart - runStart);
        const localEnd = Math.min(run.text.length, safeEnd - runStart);
        if (run.marks.code || localEnd <= localStart) {
          nextRuns.push({ text: run.text, marks: cloneMarks(run.marks) });
        } else {
          const pieces = splitRun(run, localStart, localEnd);
          const selectedIndex = localStart > 0 ? 1 : 0;
          pieces.forEach((piece, index) => {
            if (index === selectedIndex && piece.marks[mark] !== desired) {
              piece.marks[mark] = desired;
              changed = true;
            }
            nextRuns.push(piece);
          });
        }
        cursor = runEnd;
      });
      block.runs = normalizeRuns(nextRuns);
      if (blockIndex < normalized.blocks.length - 1) cursor += 1;
    });
    return { model: normalized, selectionStart: safeStart, selectionEnd: safeEnd, changed };
  }

  function toggleMark(model, start, end, mark) {
    const normalized = normalizeModel(model);
    const limit = modelTextLength(normalized);
    const safeStart = Math.max(0, Math.min(limit, Number.isFinite(start) ? start : 0));
    const safeEnd = Math.max(safeStart, Math.min(limit, Number.isFinite(end) ? end : safeStart));
    if (!['bold', 'italic', 'strike'].includes(mark)) {
      return { model: normalized, selectionStart: safeStart, selectionEnd: safeEnd, changed: false };
    }
    if (safeStart === safeEnd) {
      const current = marksAt(normalized, safeStart)[mark] === true;
      return { model: normalized, selectionStart: safeStart, selectionEnd: safeEnd, typingMark: !current, changed: false };
    }
    let cursor = 0;
    let eligible = 0;
    let allMarked = true;
    normalized.blocks.forEach((block, blockIndex) => {
      block.runs.forEach((run) => {
        const runStart = cursor;
        const runEnd = cursor + run.text.length;
        if (runEnd > safeStart && runStart < safeEnd && !run.marks.code) {
          eligible += Math.max(0, Math.min(runEnd, safeEnd) - Math.max(runStart, safeStart));
          if (!run.marks[mark]) allMarked = false;
        }
        cursor = runEnd;
      });
      if (blockIndex < normalized.blocks.length - 1) cursor += 1;
    });
    if (!eligible) return { model: normalized, selectionStart: safeStart, selectionEnd: safeEnd, changed: false };
    return setMark(normalized, safeStart, safeEnd, mark, !allMarked);
  }

  function toggleBlock(model, start, end, kind) {
    const normalized = normalizeModel(model);
    if (!BLOCK_KINDS.has(kind)) return { model: normalized, selectionStart: start || 0, selectionEnd: end || 0, changed: false };
    const limit = modelTextLength(normalized);
    const safeStart = Math.max(0, Math.min(limit, Number.isFinite(start) ? start : 0));
    const safeEnd = Math.max(safeStart, Math.min(limit, Number.isFinite(end) ? end : safeStart));
    const indexes = [];
    let cursor = 0;
    normalized.blocks.forEach((block, index) => {
      const blockStart = cursor;
      const blockEnd = cursor + block.runs.reduce((n, run) => n + run.text.length, 0);
      const hit = safeStart === safeEnd
        ? safeStart >= blockStart && safeStart <= blockEnd
        : blockEnd >= safeStart && blockStart <= safeEnd;
      if (hit) indexes.push(index);
      cursor = blockEnd + (index < normalized.blocks.length - 1 ? 1 : 0);
    });
    if (!indexes.length) indexes.push(normalized.blocks.length - 1);
    const allDesired = kind !== 'text' && indexes.every((index) => normalized.blocks[index].kind === kind);
    const outputKind = allDesired ? 'text' : kind;
    const changed = indexes.some((index) => normalized.blocks[index].kind !== outputKind);
    indexes.forEach((index) => { normalized.blocks[index].kind = outputKind; });
    return { model: normalized, selectionStart: safeStart, selectionEnd: safeEnd, changed };
  }

  const api = {
    BLOCK_KINDS,
    marksAt,
    modelTextLength,
    normalizeModel,
    parseInline,
    parseMarkdown,
    setMark,
    serializeInline,
    serializeMarkdown,
    toggleBlock,
    toggleMark,
  };
  if (typeof globalThis !== 'undefined') globalThis.DocDeepRichModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
