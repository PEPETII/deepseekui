'use strict';

  function ensureExportProgress() {
    let panel = document.querySelector('#docdeep-export-progress');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'docdeep-export-progress';
    panel.className = INJECTED;
    const text = document.createElement('span');
    text.className = 'doc-export-text';
    text.textContent = '准备导出…';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => exportState?.cancel?.());
    panel.append(text, cancel);
    document.body.appendChild(panel);
    return panel;
  }

  function setExportProgress(text) {
    const panel = ensureExportProgress();
    const label = panel.querySelector('.doc-export-text');
    if (label) label.textContent = text;
  }

  function hideExportProgress() {
    document.querySelector('#docdeep-export-progress')?.remove();
  }

  // ---- Phase-3 选择性导出纯函数(不碰 DOM,Node 可测) ----
  function buildFrontMatter({ title, url, exportedAt, schemaVersion, selection }) {
    const esc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `---\ntitle: "${esc(title)}"\nurl: "${esc(url)}"\nexportedAt: "${esc(exportedAt)}"\nschemaVersion: ${Number(schemaVersion) || 1}\nselection: "${esc(selection || 'all')}"\n---`;
  }
  // 按 user 问切分归属:选中 Q 及其后随 AI 答保留;首个 Q 前悬空 AI 跳过;空/null 即全量
  function filterRecordsByQ(records, selectedKeys) {
    const list = Array.isArray(records) ? records : [];
    if (!selectedKeys || selectedKeys.size === 0) return [...list];
    const out = [];
    let cur = null; // 当前归属 Q key(仅 user 问更新)
    list.forEach(r => {
      if (!r) return;
      if (r.role === 'user') {
        cur = r.key || null;
        if (cur && selectedKeys.has(cur)) out.push(r);
      } else if (cur && selectedKeys.has(cur)) {
        out.push(r);
      }
    });
    return out;
  }

  // ---- Phase-4 自包含 HTML(内联样式,离线可读;图片延后:仅转义文本,不内嵌远端) ----
  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function mdToHtmlBody(records) {
    const out = [];
    (Array.isArray(records) ? records : []).forEach(r => {
      if (!r || !r.text) return;
      if (r.role === 'user') {
        out.push('<h2>' + escapeHtml(stripQuestionLabel(r.text)) + '</h2>');
        return;
      }
      const blocks = String(r.text).split(/\n{2,}/);
      blocks.forEach(b => {
        const t = b.trim();
        if (!t) return;
        if (/^---+$/.test(t)) { out.push('<hr>'); return; }
        const fence = t.match(/^```([a-z0-9+#-]*)\n([\s\S]*?)\n```$/i);
        if (fence) {
          out.push('<pre><code' + (fence[1] ? ' data-lang="' + escapeHtml(fence[1]) + '"' : '') + '>' + escapeHtml(fence[2]) + '</code></pre>');
          return;
        }
        if (/^##\s+/.test(t)) { out.push('<h2>' + escapeHtml(t.replace(/^##\s+/, '')) + '</h2>'); return; }
        out.push('<p>' + escapeHtml(t).replace(/\n/g, '<br>') + '</p>');
      });
    });
    return out.join('\n');
  }
  function buildHtml(records, title, opts = {}) {
    const url = opts.url || (typeof location !== 'undefined' ? location.href : '');
    const exportedAt = opts.exportedAt || new Date().toISOString();
    const sel = opts.selectionLabel || 'all';
    const list = Array.isArray(records) ? records.filter(r => r && r.text) : [];
    return '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>'
      + escapeHtml(title) + '</title>\n<style>\n'
      + 'body{max-width:880px;margin:0 auto;padding:32px 20px;font:16px/1.9 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#2D2A26;background:#F8F7F4}\n'
      + 'h1{font-size:24px;border-bottom:1px solid #E2DBD2;padding-bottom:8px}\nh2{font-size:19px;color:#2D2A26;margin:1.2em 0 .5em}\n'
      + 'pre{background:#F1EFE8;color:#2D2A26;border-radius:10px;padding:12px 14px;overflow:auto;font-size:13px;line-height:1.7}\n'
      + 'blockquote{border-left:4px solid #C9A227;background:#FBF6E7;margin:1em 0;padding:8px 14px;color:#6B5F3F}\n'
      + 'hr{border:0;border-top:1px dashed #E2DBD2;margin:2em 0}\n.meta{color:#797368;font-size:12px}\n'
      + '</style>\n</head>\n<body>\n<h1>' + escapeHtml(title) + '</h1>\n'
      + '<p class="meta">来源 <a href="' + escapeHtml(url) + '">' + escapeHtml(url) + '</a> · 导出 ' + escapeHtml(exportedAt) + ' · 选择 ' + escapeHtml(sel) + ' · 共 ' + list.filter(r => r.role === 'user').length + ' 问</p>\n<hr>\n'
      + mdToHtmlBody(list) + '\n</body>\n</html>\n';
  }

  function turnRecord(el) {
    const text = cleanTurnText(el);
    if (!text) return null;
    const role = el.getAttribute('data-docrole');
    const user = role ? role === 'user' : (!!el.querySelector('.doc-qtag') || isUserTurn(el));
    const messageId = el.getAttribute('data-message-id')
      || el.querySelector('[data-message-id]')?.getAttribute('data-message-id');
    const key = `${user ? 'u' : 'a'}:${messageId || hashText(text)}`;
    return { key, role: user ? 'user' : 'assistant', text };
  }

  function collectVisibleTurns(records) {
    document.querySelectorAll('[data-docturn]').forEach(el => {
      const record = turnRecord(el);
      if (!record) return;
      const previous = records.get(record.key);
      if (!previous || record.text.length > previous.text.length) records.set(record.key, record);
    });
  }

  async function collectAllTurns() {
    const records = new Map();
    const container = scrollContainer();
    const initialTop = Number(container.scrollTop) || 0;
    const viewport = Math.max(240, Number(container.clientHeight) || window.innerHeight || 600);
    const step = Math.max(240, Math.floor(viewport * 0.8));
    const collect = () => {
      if (!isOn() || !exportState || exportState.cancelled) throw new Error('cancelled');
      classify();
      collectVisibleTurns(records);
    };

    setExportProgress('正在读取当前已显示内容…');
    try {
      const canScroll = Number(container.scrollHeight) > viewport + 20;
      if (canScroll) {
        scrollToExact(container, 0);
        await wait(140);
        collect();
      } else {
        collect();
      }

      let top = Number(container.scrollTop) || 0;
      let stableBottom = 0;
      let previousCount = -1;
      for (let i = 0; i < 320; i++) {
        if (!isOn() || !exportState || exportState.cancelled) throw new Error('cancelled');
        const maxTop = Math.max(0, (Number(container.scrollHeight) || 0) - viewport);
        if (top >= maxTop - 2) {
          stableBottom = records.size === previousCount ? stableBottom + 1 : 0;
          if (stableBottom >= 2) break;
          previousCount = records.size;
          await wait(140);
          collect();
          top = Number(container.scrollTop) || top;
          continue;
        }
        stableBottom = 0;
        top = Math.min(maxTop, top + step);
        scrollToExact(container, top);
        await wait(140);
        collect();
        previousCount = records.size;
        if (i % 2 === 0) setExportProgress(`正在采集对话…已发现 ${records.size} 个消息`);
      }
      setExportProgress(`已采集 ${records.size} 个消息，正在生成文件…`);
      return [...records.values()];
    } finally {
      scrollToExact(container, initialTop);
      await wait(40);
    }
  }

  function exportTitle() {
    return (document.title || 'DeepSeek 会话')
      .replace(/\s*-\s*DeepSeek\s*$/i, '')
      .trim() || 'DeepSeek 会话';
  }

  function exportFilename(title) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const safe = title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim();
    return `${(safe || 'deepseek-conversation').slice(0, 120)}-${date}`;
  }

  function buildMarkdown(records, title, opts = {}) {
    const fm = opts.frontMatter === undefined ? true : !!opts.frontMatter;
    const url = opts.url || (typeof location !== 'undefined' ? location.href : '');
    const exportedAt = opts.exportedAt || new Date().toISOString();
    const head = fm ? buildFrontMatter({
      title,
      url,
      exportedAt,
      schemaVersion: 1,
      selection: opts.selectionLabel || 'all',
    }) + '\n\n' : '';
    let questionNumber = 0;
    const parts = records.map(record => {
      if (record.role === 'user') {
        questionNumber++;
        // 选中导出保持原 Q 号(如 Q7),全量/无 key 时回退顺序号
        let n = questionNumber;
        try {
          if (record.key && typeof opts.qNumberOf === 'function') {
            const keep = Number(opts.qNumberOf(record.key));
            if (keep > 0) n = keep;
          }
        } catch {}
        return `## Q${n} 我的提问\n\n${stripQuestionLabel(record.text)}`;
      }
      return record.text;
    }).filter(Boolean);
    return `${head}# ${title}\n\n${parts.join('\n\n---\n\n')}\n`;
  }

  function buildExport(format, records, title, opts = {}) {
    if (format === 'json') {
      return JSON.stringify({
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        title,
        url: location.href,
        turns: records.map(record => ({ role: record.role, text: record.text })),
      }, null, 2);
    }
    if (format === 'html') return buildHtml(records, title, opts);
    return buildMarkdown(records, title, opts);
  }

  function requestDownload(message) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage(message, response => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(response || null);
        });
      } catch { resolve(null); }
    });
  }

  function fallbackDownload(format, content, filename) {
    try {
      const mime = format === 'json' ? 'application/json' : format === 'html' ? 'text/html' : 'text/markdown';
      const ext = format === 'json' ? 'json' : format === 'html' ? 'html' : 'md';
      const blob = new Blob([content], { type: `${mime};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filename}.${ext}`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    } catch { return false; }
  }

  async function exportConversation(format = 'md', opts = {}) {
    if (exportState) {
      toast('已有导出任务正在进行');
      return false;
    }
    // Phase-3: 选中导出(MD/HTML 共用同一 onlySelected 链路,JSON 保持全量语义由调用方决定);空选中给人话并中止
    const onlySelected = !!opts.onlySelected;
    if (onlySelected && selectedQKeys !== null && selectedQKeys.size === 0) {
      toast('请先勾选要导出的提问');
      return false;
    }
    const job = { cancelled: false, cancel() { this.cancelled = true; } };
    exportState = job;
    ensureExportProgress();
    try {
      const all = await collectAllTurns();
      if (!all.length) throw new Error('empty');
      const records = onlySelected ? filterRecordsByQ(all, selectedQKeys) : all;
      if (!records.length) {
        toast('请先勾选要导出的提问');
        return false;
      }
      const title = exportTitle();
      // 选中导出保持原 Q 号;selection 标签按 qOrder 顺序(Q2,Q5),全量记 all
      const sel = onlySelected && selectedQKeys !== null
        ? qOrder.filter(k => selectedQKeys.has(k)).map(k => 'Q' + qNumberOf(k)).join(',')
        : 'all';
      const content = buildExport(format, records, title, {
        selectionLabel: sel,
        qNumberOf: (k) => qNumberOf(k),
      });
      const filename = exportFilename(title);
      const response = await requestDownload({
        type: 'DOCDEEP_DOWNLOAD',
        format,
        filename,
        content,
      });
      const ok = response?.ok || fallbackDownload(format, content, filename);
      if (!ok) throw new Error('download');
      toast(format === 'json' ? 'JSON 已导出到下载目录' : format === 'html' ? 'HTML 已导出到下载目录' : 'Markdown 已导出到下载目录');
      return true;
    } catch (error) {
      if (error?.message === 'cancelled') toast('导出已取消');
      else {
        console.warn('[docdeep] export failed', error);
        toast('导出失败,请确认页面仍有对话内容');
      }
      return false;
    } finally {
      hideExportProgress();
      exportState = null;
    }
  }

  async function copyFull() {
    const turns = [...document.querySelectorAll('[data-docturn]')];
    if (!turns.length) return false;
    const parts = turns.map(el => {
      const t = cleanTurnText(el);
      if (!t) return null;
      if (el.getAttribute('data-docrole') === 'user' || (!el.getAttribute('data-docrole') && el.querySelector('.doc-qtag'))) {
        const key = keyForTurnEl(el, 'user', stripQuestionLabel(t));
        const n = qNumberOf(key) || 0;
        const head = n ? '## Q' + n + ' 我的提问' : '## 我的提问';
        return head + '\n\n' + t.replace(/^Q\d+ · 我的提问\s*/, '');
      }
      return t;
    }).filter(Boolean);
    const title = (document.title || '').replace(/\s*-\s*DeepSeek\s*$/, '').trim();
    const text = (title ? '# ' + title + '\n\n' : '') + parts.join('\n\n---\n\n');
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch { return false; }
    }
  }
