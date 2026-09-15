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
