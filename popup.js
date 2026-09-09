// popup v0.3.21: 阅读设置 + 搜索/导出 + 本地会话收藏
const $ = (id) => document.getElementById(id);
// POPUP_VER 与 manifest.json / content.js VERSION 三处同步(见 AGENTS.md 版本号规则)
const POPUP_VER = '0.3.21';
const DEFAULTS = { docdeep_enabled: true, docdeep_width: 880, docdeep_font: 17, docdeep_theme: 'mi', docdeep_outline: true, docdeep_keys: true, docdeep_hide_native: false, docdeep_format: true };
const BOOKMARKS_KEY = 'docdeep_bookmarks';
const SCHEMA_VER = 2;
const SCHEMA_KEY = 'docdeep_schema_ver';
const BOOKMARKS_MAX = 100;
const TAG_MAX = 24;
let bookmarks = [];

function isDeepSeekUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'chat.deepseek.com';
  } catch { return false; }
}

async function tab() {
  try {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    return isDeepSeekUrl(t?.url) ? t : null;
  } catch { return null; }
}
async function notify(msg, timeout = 2500) {
  const t = await tab();
  if (!t?.id) return null;
  try {
    return await Promise.race([
      chrome.tabs.sendMessage(t.id, msg),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout)),
    ]);
  } catch { return null; }
}

async function sendPage(msg) {
  const t = await tab();
  if (!t?.id) return false;
  try {
    const pending = chrome.tabs.sendMessage(t.id, msg);
    if (pending?.catch) pending.catch(() => {});
    return true;
  } catch { return false; }
}

function isDeepSeekTab(t) {
  return isDeepSeekUrl(t?.url);
}

function bookmarkId(url) {
  return String(url || '').trim();
}

function normalizeBookmarks(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item && isDeepSeekUrl(item.url))
    .map(item => ({
      id: bookmarkId(item.id || item.url),
      url: item.url,
      title: String(item.title || '未命名会话').trim() || '未命名会话',
      tag: String(item.tag || '').trim().slice(0, TAG_MAX),
      createdAt: Number(item.createdAt) || Date.now(),
      updatedAt: Number(item.updatedAt) || Number(item.createdAt) || Date.now(),
    }))
    .filter(item => item.id)
    .slice(0, BOOKMARKS_MAX);
}

// 幂等迁移：任意输入 -> 规范数组；已规范输入保持稳定（时间戳已存在则不再抖动）
function migrateBookmarks(stored) {
  const raw = Array.isArray(stored) ? stored : (stored && Array.isArray(stored.bookmarks) ? stored.bookmarks : []);
  return normalizeBookmarks(raw);
}

// 纯函数过滤：q 匹配 标题/标签/链接（大小写不敏感子串）；tag: ''/'all'=全部，'__none__'=未分类，其余精确匹配
function filterBookmarks(list, opts) {
  const arr = Array.isArray(list) ? list : [];
  const q = String(opts?.q ?? '').trim().toLowerCase();
  const tag = opts?.tag ?? '';
  return arr.filter(item => {
    if (!item || typeof item !== 'object') return false;
    if (tag === '__none__') {
      if (String(item.tag || '').trim()) return false;
    } else if (tag && tag !== 'all') {
      if (String(item.tag || '') !== String(tag)) return false;
    }
    if (!q) return true;
    const hay = `${item.title || ''} ${item.tag || ''} ${item.url || ''}`.toLowerCase();
    return hay.includes(q);
  });
}

// 永不抛异常、不碰旧数据；支持裸数组或 {bookmarks:[...]}；文件内按 id 去重保序
function parseImportBookmarks(text) {
  try {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, bookmarks: [], skipped: 0, reason: '文件为空' };
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, bookmarks: [], skipped: 0, reason: '不是有效的 JSON' };
    }
    const raw = Array.isArray(data) ? data : (data && Array.isArray(data.bookmarks) ? data.bookmarks : null);
    if (!raw) return { ok: false, bookmarks: [], skipped: 0, reason: '未找到 bookmarks 数组' };
    const normalized = normalizeBookmarks(raw);
    const seen = new Set();
    const deduped = [];
    for (const b of normalized) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      deduped.push(b);
    }
    const kept = deduped.slice(0, BOOKMARKS_MAX);
    const skipped = raw.length - kept.length;
    return { ok: true, bookmarks: kept, skipped, reason: '' };
  } catch {
    return { ok: false, bookmarks: [], skipped: 0, reason: '解析异常' };
  }
}

function exportFileDate(d) {
  const t = d instanceof Date ? d : new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  if (Number.isNaN(t.getTime())) return '19700101';
  return `${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}`;
}

// 纯构造：settings 取 7 键，bookmarks 经 normalize；供单测与导出共用
function buildBookmarksExport(settings, list, now) {
  const s = settings || {};
  const safeSettings = {
    docdeep_enabled: s.docdeep_enabled ?? DEFAULTS.docdeep_enabled,
    docdeep_width: s.docdeep_width ?? DEFAULTS.docdeep_width,
    docdeep_font: s.docdeep_font ?? DEFAULTS.docdeep_font,
    docdeep_theme: s.docdeep_theme ?? DEFAULTS.docdeep_theme,
    docdeep_outline: s.docdeep_outline ?? DEFAULTS.docdeep_outline,
    docdeep_keys: s.docdeep_keys ?? DEFAULTS.docdeep_keys,
    docdeep_format: s.docdeep_format ?? DEFAULTS.docdeep_format,
  };
  const date = exportFileDate(now instanceof Date ? now : new Date());
  const ts = now instanceof Date && !Number.isNaN(now.getTime()) ? now.toISOString() : new Date().toISOString();
  return {
    filename: `docdeep-bookmarks-${date}.json`,
    content: JSON.stringify({
      app: 'docdeep',
      kind: 'bookmarks',
      version: SCHEMA_VER,
      exportedAt: ts,
      settings: safeSettings,
      bookmarks: normalizeBookmarks(list),
    }, null, 2),
  };
}

// 触发下载并返回 {filename, content}；失败走 Blob fallback，永不抛异常
async function exportBookmarks() {
  let settings = { ...DEFAULTS };
  try {
    const stored = await chrome.storage.local.get(DEFAULTS);
    settings = { ...DEFAULTS, ...stored };
  } catch {}
  const payload = buildBookmarksExport(settings, bookmarks, new Date());
  const base = payload.filename.replace(/\.json$/i, '');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'DOCDEEP_DOWNLOAD', format: 'json', filename: base, content: payload.content });
    if (res?.ok) {
      try { $('tip').textContent = '收藏已导出到下载目录。'; } catch {}
      return payload;
    }
  } catch {}
  try {
    const blob = new Blob([payload.content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = payload.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 1000);
    try { $('tip').textContent = '收藏已导出到下载目录。'; } catch {}
  } catch {
    try { $('tip').textContent = '导出失败，请重试。'; } catch {}
  }
  return payload;
}

// 去重 tag 列表（默认读全局 bookmarks），中文排序，供下拉框使用
function getTagOptions(list) {
  const src = Array.isArray(list) ? list : (typeof bookmarks !== 'undefined' && Array.isArray(bookmarks) ? bookmarks : []);
  const set = new Set();
  src.forEach(item => {
    const t = String(item?.tag || '').trim();
    if (t) set.add(t);
  });
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function getBookmarkFilter() {
  try {
    const q = document.getElementById('bookmark-search')?.value || '';
    const tag = document.getElementById('bookmark-tag-filter')?.value ?? '';
    return { q, tag };
  } catch {
    return { q: '', tag: '' };
  }
}

function refreshTagFilterOptions() {
  const sel = (typeof document !== 'undefined') ? document.getElementById('bookmark-tag-filter') : null;
  if (!sel) return;
  const cur = sel.value;
  const tags = getTagOptions();
  sel.textContent = '';
  const mk = (value, label) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  };
  sel.append(mk('', '全部'), mk('__none__', '未分类'));
  tags.forEach(t => sel.append(mk(t, t)));
  try {
    if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
    else sel.value = '';
  } catch {}
}

function renderBookmarks(filter) {
  const list = (typeof document !== 'undefined') ? $('bookmark-list') : null;
  if (!list) return;
  list.textContent = '';
  const f = filter || getBookmarkFilter();
  const filtered = filterBookmarks(bookmarks, f);
  if (!bookmarks.length) {
    const empty = document.createElement('div');
    empty.className = 'bookmark-empty';
    empty.textContent = '暂无收藏，会话只保存标题和链接。';
    list.appendChild(empty);
    return;
  }
  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'bookmark-empty';
    empty.textContent = '无匹配，换个关键词或标签试试。';
    list.appendChild(empty);
    return;
  }
  filtered.forEach(item => {
    const row = document.createElement('div');
    row.className = 'bookmark-item';
    const info = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'bookmark-title';
    title.title = item.title;
    title.textContent = item.title;
    const meta = document.createElement('div');
    meta.className = 'bookmark-meta';
    meta.textContent = item.tag || '未分类';
    info.append(title, meta);
    const actions = document.createElement('div');
    actions.className = 'bookmark-actions';
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = '打开';
    open.setAttribute('aria-label', `打开收藏 ${item.title}`);
    open.addEventListener('click', () => chrome.tabs.create({ url: item.url }));
    const rename = document.createElement('button');
    rename.type = 'button';
    rename.textContent = '改名';
    rename.setAttribute('aria-label', `重命名收藏 ${item.title}`);
    rename.addEventListener('click', () => {
      try {
        const next = prompt('重命名收藏', item.title);
        if (next === null) return;
        renameBookmark(item.id, next);
      } catch {}
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '删除';
    remove.setAttribute('aria-label', `删除收藏 ${item.title}`);
    remove.addEventListener('click', () => removeBookmark(item.id));
    actions.append(open, rename, remove);
    row.append(info, actions);
    list.appendChild(row);
  });
}

async function persistBookmarks(next) {
  bookmarks = normalizeBookmarks(next).slice(0, BOOKMARKS_MAX);
  try {
    await chrome.storage.local.set({ [BOOKMARKS_KEY]: bookmarks, [SCHEMA_KEY]: SCHEMA_VER });
    return true;
  } catch {
    try { $('tip').textContent = '本地存储已满或写入失败，仅保留本次显示。'; } catch {}
    return false;
  }
}

async function loadBookmarks() {
  try {
    const stored = await chrome.storage.local.get({ [BOOKMARKS_KEY]: [], [SCHEMA_KEY]: 0 });
    const ver = Number(stored[SCHEMA_KEY]) || 0;
    const list = migrateBookmarks(stored[BOOKMARKS_KEY]);
    // Review建议：老数据迁移后显式按 updatedAt 倒序，保证首屏有序（新写入路径已是倒序）
    list.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
    bookmarks = list;
    if (ver !== SCHEMA_VER) {
      try {
        await chrome.storage.local.set({ [BOOKMARKS_KEY]: list, [SCHEMA_KEY]: SCHEMA_VER });
      } catch {
        try { $('tip').textContent = '本地存储已满或写入失败，仅保留本次显示。'; } catch {}
      }
    }
  } catch {
    bookmarks = [];
    try { $('tip').textContent = '收藏读取失败，已显示为空，不影响其他功能。'; } catch {}
  }
  try { refreshTagFilterOptions(); } catch {}
  try { renderBookmarks(); } catch {}
  try {
    const t = await tab();
    const current = t ? bookmarks.find(item => item.id === bookmarkId(t.url)) : null;
    if (typeof document !== 'undefined' && $('bookmark')) {
      $('bookmark').textContent = current ? '更新收藏' : '收藏当前会话';
    }
  } catch {}
}

async function saveBookmark() {
  const t = await tab();
  if (!isDeepSeekTab(t)) {
    $('tip').textContent = '请先打开 DeepSeek 会话。';
    return;
  }
  const now = Date.now();
  const id = bookmarkId(t.url);
  const title = String(t.title || '未命名会话').replace(/\s*-\s*DeepSeek\s*$/i, '').trim() || '未命名会话';
  const tag = $('bookmark-tag').value.trim().slice(0, TAG_MAX);
  const previous = bookmarks.find(item => item.id === id);
  const next = {
    id,
    url: t.url,
    title,
    tag: tag || previous?.tag || '',
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };
  bookmarks = [next, ...bookmarks.filter(item => item.id !== id)].slice(0, BOOKMARKS_MAX);
  try {
    await chrome.storage.local.set({ [BOOKMARKS_KEY]: bookmarks, [SCHEMA_KEY]: SCHEMA_VER });
  } catch {
    $('tip').textContent = '本地存储已满或写入失败，仅保留本次显示。';
    renderBookmarks();
    return;
  }
  $('bookmark-tag').value = next.tag;
  $('tip').textContent = '当前会话已保存到本地收藏。';
  try { refreshTagFilterOptions(); } catch {}
  renderBookmarks();
  $('bookmark').textContent = '更新收藏';
}

async function removeBookmark(id) {
  bookmarks = bookmarks.filter(item => item.id !== id);
  try {
    await chrome.storage.local.set({ [BOOKMARKS_KEY]: bookmarks, [SCHEMA_KEY]: SCHEMA_VER });
  } catch {
    $('tip').textContent = '本地存储已满或写入失败，仅保留本次显示。';
    renderBookmarks();
    return;
  }
  try { refreshTagFilterOptions(); } catch {}
  renderBookmarks();
  try {
    const t = await tab();
    $('bookmark').textContent = t && bookmarks.some(item => item.id === bookmarkId(t.url)) ? '更新收藏' : '收藏当前会话';
  } catch {}
  $('tip').textContent = '已从本地收藏移除。';
}

async function renameBookmark(id, newTitle) {
  const prev = bookmarks.find(item => item.id === id);
  if (!prev) return false;
  const title = String(newTitle ?? '').trim() || prev.title || '未命名会话';
  const next = { ...prev, title, updatedAt: Date.now() };
  bookmarks = [next, ...bookmarks.filter(item => item.id !== id)].slice(0, BOOKMARKS_MAX);
  try {
    await chrome.storage.local.set({ [BOOKMARKS_KEY]: bookmarks, [SCHEMA_KEY]: SCHEMA_VER });
  } catch {
    try { $('tip').textContent = '本地存储已满或写入失败，仅保留本次显示。'; } catch {}
    try { renderBookmarks(); } catch {}
    return false;
  }
  try { renderBookmarks(); } catch {}
  try { $('tip').textContent = '已重命名并置顶。'; } catch {}
  return true;
}

async function handleImportFile(file) {
  const say = (s) => { try { ($('tip')).textContent = s; } catch {} };
  if (!file) return { ok: false, imported: 0, skipped: 0 };
  let text = '';
  try {
    text = await file.text();
  } catch {
    say('导入失败：无法读取文件，旧收藏未动。');
    return { ok: false, imported: 0, skipped: 0 };
  }
  const parsed = parseImportBookmarks(text);
  if (!parsed.ok) {
    say(`导入失败：${parsed.reason}，旧收藏未动。`);
    return { ok: false, imported: 0, skipped: 0 };
  }
  // 合并：导入条目优先、旧收藏其余保序追加、总数截断 BOOKMARKS_MAX
  const seen = new Set(parsed.bookmarks.map(b => b.id));
  const merged = [...parsed.bookmarks];
  for (const b of bookmarks) {
    if (!seen.has(b.id)) {
      merged.push(b);
      seen.add(b.id);
    }
  }
  const totalBefore = parsed.bookmarks.length + bookmarks.length;
  const finalList = merged.slice(0, BOOKMARKS_MAX);
  const truncated = totalBefore - parsed.skipped - finalList.length;
  const skippedTotal = parsed.skipped + Math.max(0, truncated);
  const ok = await persistBookmarks(finalList);
  try { refreshTagFilterOptions(); } catch {}
  try { renderBookmarks(); } catch {}
  if (ok) say(`导入完成：成功 ${parsed.bookmarks.length} 条，跳过 ${skippedTotal} 条。`);
  try {
    const t = await tab();
    if (typeof document !== 'undefined' && $('bookmark')) {
      $('bookmark').textContent = t && finalList.some(item => item.id === bookmarkId(t.url)) ? '更新收藏' : '收藏当前会话';
    }
  } catch {}
  return { ok, imported: parsed.bookmarks.length, skipped: skippedTotal };
}
function paint(s) {
  $('sw').setAttribute('aria-checked', String(s.docdeep_enabled !== false));
  $('ol').setAttribute('aria-checked', String(s.docdeep_outline !== false));
  $('keys').setAttribute('aria-checked', String(s.docdeep_keys !== false));
  $('nav').setAttribute('aria-checked', String(s.docdeep_hide_native === true));
  $('format').setAttribute('aria-checked', String(s.docdeep_format !== false));
  $('width').value = '880'; // PAPER-WIDTH-001: 冻结显示
  $('font').value = String(s.docdeep_font);
  $('theme').value = s.docdeep_theme;
  document.documentElement.dataset.theme = (s.docdeep_theme === 'mo') ? 'dark' : 'light'; // 深色分支跟随页面墨色主题
  $('tip').textContent = (s.docdeep_enabled !== false)
    ? '已启用。关闭后页面即恢复原站，无需刷新。'
    : '已关闭，原站样式已恢复，原功能不受影响。';
}
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
[['width', 'docdeep_width', Number], ['font', 'docdeep_font', Number], ['theme', 'docdeep_theme', String]].forEach(([id, key, fn]) => {
  $(id).addEventListener('change', async () => {
    const v = fn($(id).value);
    if (key === 'docdeep_theme') document.documentElement.dataset.theme = (v === 'mo') ? 'dark' : 'light';
    try { await chrome.storage.local.set({ [key]: v }); }
    catch { $('tip').textContent = '本地存储已满或写入失败，仅保留本次显示。'; return; }
    let s = { ...DEFAULTS };
    try { s = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) }; } catch {}
    await notify({ type: 'DOCDEEP_SETTINGS', settings: s });
  });
});
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

// 分区切换与状态提示：任何文档环境都接（扩展面板 / 本地预览）
if (typeof document !== 'undefined') {
  try { initTabs(); } catch {}
  try { initStatusFlash(); } catch {}
}
