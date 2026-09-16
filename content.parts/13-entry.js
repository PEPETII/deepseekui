'use strict';
  // --- 启动 ---
  console.log('[docdeep] 内容脚本 v' + VERSION + ' 已加载');
  chrome.storage.local.get(DEFAULTS).then((s) => {
    applySettings(s);
    setOn(s.docdeep_enabled !== false);
    classify();
    initAddToBox();
    console.log('[docdeep] 设置已应用', JSON.stringify({ w: settings.docdeep_width, f: settings.docdeep_font, t: settings.docdeep_theme }));
  });

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('scroll', () => {
    scheduleSpy();
    scheduleFormattingToolbarPosition();
    scheduleRichEditorPosition();
  }, true); // 捕获滚动(含虚拟列表), 仅做大纲高亮 + 工具栏定位
  window.addEventListener('resize', () => {
    scheduleFormattingToolbarPosition();
    scheduleRichEditorPosition();
  });
  const rawPush = history.pushState;
  history.pushState = function (...a) { hideFormattingToolbar(); const r = rawPush.apply(this, a); schedule(); return r; };
  const rawRep = history.replaceState;
  history.replaceState = function (...a) { hideFormattingToolbar(); const r = rawRep.apply(this, a); schedule(); return r; };
  window.addEventListener('popstate', () => { hideFormattingToolbar(); schedule(); });

  chrome.runtime.onMessage.addListener((msg, _s, send) => {
    if (msg?.type === 'DOCDEEP_TOGGLE') { setOn(!!msg.on); classify(); }
    if (msg?.type === 'DOCDEEP_SETTINGS') { applySettings(msg.settings || {}); classify(); }
    if (msg?.type === 'DOCDEEP_TOP') scrollTop();
    if (msg?.type === 'DOCDEEP_FIND') openFind();
    if (msg?.type === 'DOCDEEP_PRINT') window.print();
    if (msg?.type === 'DOCDEEP_COPY') { copyFull().then(ok => send({ ok })); return true; }
    if (msg?.type === 'DOCDEEP_EXPORT') {
      const f = msg.format === 'json' ? 'json' : msg.format === 'html' ? 'html' : 'md';
      exportConversation(f, { onlySelected: !!msg.onlySelected });
      return false;
    }
  });
  chrome.storage.onChanged.addListener((chg, area) => {
    if (area !== 'local') return;
    const next = {};
    ['docdeep_enabled', 'docdeep_width', 'docdeep_font', 'docdeep_theme', 'docdeep_outline', 'docdeep_keys', 'docdeep_hide_native', 'docdeep_format', 'docdeep_addtobox', 'docdeep_hide_think', 'docdeep_template_background'].forEach(k => {
      if (chg[k]) next[k] = chg[k].newValue;
    });
    applySettings({ ...settings, ...next });
    if ('docdeep_enabled' in next) setOn(next.docdeep_enabled !== false);
    classify();
  });
