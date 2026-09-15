// popup v0.3.38: 阅读设置 + 外观模板 + 搜索/导出 + 本地会话收藏
const $ = (id) => document.getElementById(id);
// POPUP_VER 与 manifest.json / content.parts/00-runtime.js VERSION 三处同步(见 AGENTS.md 版本号规则)
const POPUP_VER = '0.3.38';
const DEFAULTS = { docdeep_enabled: true, docdeep_width: 880, docdeep_font: 17, docdeep_theme: 'mi', docdeep_outline: true, docdeep_keys: true, docdeep_hide_native: false, docdeep_format: true, docdeep_addtobox: true, docdeep_hide_think: true };
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
    docdeep_addtobox: s.docdeep_addtobox ?? DEFAULTS.docdeep_addtobox,
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
