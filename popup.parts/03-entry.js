async function load() {
  try {
    const s = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
    paint(s);
  } catch {
    try { paint({ ...DEFAULTS }); } catch {}
  }
  loadBookmarks();
  // 历史遗留键清理：已下线功能留下的存储键（备份系列 + 页面心跳快照），老版本存量不留残骸
  try { await chrome.storage.local.remove(['docdeep_history_v1', 'docdeep_backup', 'docdeep_backup_mins', 'docdeep_backup_keep', 'docdeep_heartbeat']); } catch {}
}

// ---- v0.3.4-ui: 分区切换 / 状态提示（纯显示层，不触碰业务数据）----
function initTabs() {
  const tabs = [...document.querySelectorAll('.tab')];
  const panes = [...document.querySelectorAll('.pane')];
  if (!tabs.length || !panes.length) return;
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => {
        const on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', String(on));
      });
      panes.forEach(p => p.classList.toggle('is-active', p.dataset.pane === tab.dataset.tab));
    });
  });
}

// 状态条内容变化时闪一下，避免反馈藏在底部没人看见（flash 只加类，不写内容）
function initStatusFlash() {
  const tip = $('tip');
  if (!tip) return;
  try {
    new MutationObserver(() => {
      tip.classList.remove('flash');
      void tip.offsetWidth;
      tip.classList.add('flash');
    }).observe(tip, { childList: true, characterData: true, subtree: true });
  } catch {}
}

// Node 单测导出（浏览器下 module 未定义，不执行）
try {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      DEFAULTS, BOOKMARKS_KEY, SCHEMA_VER, SCHEMA_KEY, BOOKMARKS_MAX, TAG_MAX,
      isDeepSeekUrl, bookmarkId, normalizeBookmarks, migrateBookmarks,
      filterBookmarks, parseImportBookmarks, exportFileDate, buildBookmarksExport, getTagOptions,
      TEMPLATES, activeTemplate,
    };
  }
} catch {}

// 以下 DOM 接线仅在扩展 popup 环境执行，Node 下跳过（保证单测不崩）
if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome.storage) {
$('sw').addEventListener('click', async () => {
  const on = $('sw').getAttribute('aria-checked') !== 'true';
  try { await chrome.storage.local.set({ docdeep_enabled: on }); } catch { $('tip').textContent = '本地存储已满或写入失败，仅保留本次显示。'; return; }
  await notify({ type: 'DOCDEEP_TOGGLE', on });
  load();
});
$('ol').addEventListener('click', async () => {
  const on = $('ol').getAttribute('aria-checked') !== 'true';
  try { await chrome.storage.local.set({ docdeep_outline: on }); } catch { $('tip').textContent = '本地存储已满或写入失败，仅保留本次显示。'; return; }
  await notify({ type: 'DOCDEEP_SETTINGS', settings: { docdeep_outline: on } });
  load();
});
$('keys').addEventListener('click', async () => {
  const on = $('keys').getAttribute('aria-checked') !== 'true';
  try { await chrome.storage.local.set({ docdeep_keys: on }); } catch { $('tip').textContent = '本地存储已满或写入失败，仅保留本次显示。'; return; }
  await notify({ type: 'DOCDEEP_SETTINGS', settings: { docdeep_keys: on } });
  load();
});
$('nav').addEventListener('click', async () => {
  const on = $('nav').getAttribute('aria-checked') !== 'true';
  try { await chrome.storage.local.set({ docdeep_hide_native: on }); } catch { $('tip').textContent = '本地存储已满或写入失败，仅保留本次显示。'; return; }
  await notify({ type: 'DOCDEEP_SETTINGS', settings: { docdeep_hide_native: on } });
  load();
});
$('format').addEventListener('click', async () => {
  const on = $('format').getAttribute('aria-checked') !== 'true';
  try { await chrome.storage.local.set({ docdeep_format: on }); } catch { $('tip').textContent = '本地存储已满或写入失败，仅保留本次显示。'; return; }
  await notify({ type: 'DOCDEEP_SETTINGS', settings: { docdeep_format: on } });
  load();
});
$('addtobox').addEventListener('click', async () => {
  const on = $('addtobox').getAttribute('aria-checked') !== 'true';
  try { await chrome.storage.local.set({ docdeep_addtobox: on }); } catch { $('tip').textContent = '本地存储已满或写入失败，仅保留本次显示。'; return; }
  await notify({ type: 'DOCDEEP_SETTINGS', settings: { docdeep_addtobox: on } });
  load();
});
$('hidethink').addEventListener('click', async () => {
  const on = $('hidethink').getAttribute('aria-checked') !== 'true';
  try { await chrome.storage.local.set({ docdeep_hide_think: on }); } catch { $('tip').textContent = '本地存储已满或写入失败，仅保留本次显示。'; return; }
  await notify({ type: 'DOCDEEP_SETTINGS', settings: { docdeep_hide_think: on } });
  load();
});
[['width', 'docdeep_width', Number], ['font', 'docdeep_font', Number]].forEach(([id, key, fn]) => {
  $(id).addEventListener('change', async () => {
    const v = fn($(id).value);
    try { await chrome.storage.local.set({ [key]: v }); }
    catch { $('tip').textContent = '本地存储已满或写入失败，仅保留本次显示。'; return; }
    let s = { ...DEFAULTS };
    try { s = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) }; } catch {}
    await notify({ type: 'DOCDEEP_SETTINGS', settings: s });
  });
});
// 纸张主题下拉与「模板」卡共用 applyTheme，避免两个入口各写一套逻辑后漂移
$('theme').addEventListener('change', () => { applyTheme($('theme').value); });
$('copy').addEventListener('click', async () => {
  const r = await notify({ type: 'DOCDEEP_COPY' });
  $('tip').textContent = r?.ok ? '全文已复制,去笔记里粘贴吧。' : '本页暂无可复制内容,或请先点开对话。';
});
$('top').addEventListener('click', () => notify({ type: 'DOCDEEP_TOP' }));
$('find').addEventListener('click', async () => {
  const ok = await sendPage({ type: 'DOCDEEP_FIND' });
  if (!ok) $('tip').textContent = '请先打开 DeepSeek 会话。';
});
$('print').addEventListener('click', async () => {
  const ok = await sendPage({ type: 'DOCDEEP_PRINT' });
  if (!ok) $('tip').textContent = '请先打开 DeepSeek 会话。';
});
$('export-md').addEventListener('click', async () => {
  const ok = await sendPage({ type: 'DOCDEEP_EXPORT', format: 'md' });
  $('tip').textContent = ok ? '已开始采集，会话较长时页面会显示进度。' : '请先打开 DeepSeek 会话。';
});
$('export-json').addEventListener('click', async () => {
  const ok = await sendPage({ type: 'DOCDEEP_EXPORT', format: 'json' });
  $('tip').textContent = ok ? '已开始采集，会话较长时页面会显示进度。' : '请先打开 DeepSeek 会话。';
});
$('export-html').addEventListener('click', async () => {
  const ok = await sendPage({ type: 'DOCDEEP_EXPORT', format: 'html' });
  $('tip').textContent = ok ? '已开始采集，会话较长时页面会显示进度。' : '请先打开 DeepSeek 会话。';
});
$('bookmark').addEventListener('click', saveBookmark);
if ($('bookmark-search')) $('bookmark-search').addEventListener('input', () => renderBookmarks());
if ($('bookmark-tag-filter')) $('bookmark-tag-filter').addEventListener('change', () => renderBookmarks());
if ($('bookmark-export')) $('bookmark-export').addEventListener('click', exportBookmarks);
if ($('bookmark-import')) $('bookmark-import').addEventListener('change', async (e) => {
  const file = e.target?.files?.[0];
  await handleImportFile(file);
  try { e.target.value = ''; } catch {}
});

load();
} else if (typeof document !== 'undefined') {
  // 非扩展环境（如 file:// 预览）仅保证不崩，不接线
  try { document.addEventListener('DOMContentLoaded', () => {}); } catch {}
}

// 分区切换、状态提示、模板卡：任何文档环境都接（扩展面板 / 本地预览）
if (typeof document !== 'undefined') {
  try { initTabs(); } catch {}
  try { initStatusFlash(); } catch {}
  try { initTemplates(); } catch {}
}
