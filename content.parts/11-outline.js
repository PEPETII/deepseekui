'use strict';
  // ---- 右侧大纲: Q + AI 内 h1/h2/h3 ----

  function toggleOutlinePanel() {
    buildOutline();
    const box = document.querySelector('#docdeep-outline');
    if (!box) return;
    if (!box.querySelector('.doc-ol-item')) return;
    if (window.matchMedia?.('(max-width: 1280px)').matches) {
      box.classList.toggle('doc-ol-mobile-open');
    } else {
      box.classList.toggle('doc-ol-collapsed');
    }
  }

  function ensureOutlineShell() {
    // Task3: 过滤框挂载逻辑内聚于本函数内, 不新增顶层函数, 不碰其它段
    // Phase-2: 补全按钮挂载同样内聚于此, 位于过滤框下、列表上
    const ensureCompleteBtn = (b) => {
      let btn = b.querySelector('.doc-ol-complete');
      if (btn) return btn;
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'doc-ol-complete ' + INJECTED;
      btn.textContent = '滚动补全全部';
      btn.setAttribute('aria-label', '一键补全大纲:滚动加载全部提问');
      btn.addEventListener('click', () => { completeOutline(); });
      const lst = b.querySelector('.doc-ol-list');
      if (lst) b.insertBefore(btn, lst);
      else b.appendChild(btn);
      return btn;
    };
    const attachFilter = (b) => {
      if (b.querySelector('.doc-ol-filter')) return b.querySelector('.doc-ol-filter');
      const inp = document.createElement('input');
      inp.type = 'search';
      inp.className = 'doc-ol-filter ' + INJECTED;
      inp.placeholder = '过滤大纲…';
      inp.setAttribute('aria-label', '过滤大纲');
      inp.addEventListener('input', () => {
        if (inp._olT) clearTimeout(inp._olT);
        inp._olT = setTimeout(() => { buildOutline(); }, 150);
      });
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); });
      inp.addEventListener('keypress', (e) => { e.stopPropagation(); });
      inp.addEventListener('keyup', (e) => { e.stopPropagation(); });
      const lst = b.querySelector('.doc-ol-list');
      if (lst) b.insertBefore(inp, lst);
      else b.appendChild(inp);
      return inp;
    };
    let box = document.querySelector('#docdeep-outline');
    if (box) { attachFilter(box); ensureCompleteBtn(box); ensureSelBar(box); return box; }
    box = document.createElement('div');
    box.id = 'docdeep-outline';
    box.className = INJECTED;
    box.innerHTML = '<h4><span>本文大纲</span><button type="button">收起</button></h4><div class="doc-ol-list"></div>';
    box.querySelector('button').addEventListener('click', () => {
      box.classList.toggle('doc-ol-collapsed');
      box.querySelector('button').textContent = box.classList.contains('doc-ol-collapsed') ? '展开' : '收起';
    });
    attachFilter(box);
    ensureCompleteBtn(box);
    ensureSelBar(box);
    document.body.appendChild(box);
    return box;
  }

  // ---- 导出格式选择弹窗(目录“导出选中”统一入口,复用 exportConversation,不复制采集逻辑) ----
  let exportDialogEscBound = false;
  function ensureExportDialog() {
    let mask = document.querySelector('#docdeep-export-dialog');
    if (mask) return mask;
    mask = document.createElement('div');
    mask.id = 'docdeep-export-dialog';
    mask.className = INJECTED;
    mask.setAttribute('role', 'dialog');
    mask.setAttribute('aria-modal', 'true');
    mask.setAttribute('aria-label', '选择导出格式');
    mask.style.display = 'none';
    const panel = document.createElement('div');
    panel.className = 'doc-export-dialog-panel ' + INJECTED;
    const title = document.createElement('div');
    title.className = 'doc-export-dialog-title ' + INJECTED;
    title.textContent = '选择导出格式';
    const sub = document.createElement('div');
    sub.className = 'doc-export-dialog-sub ' + INJECTED;
    sub.textContent = '仅导出已勾选内容';
    const mdBtn = document.createElement('button');
    mdBtn.type = 'button';
    mdBtn.className = 'doc-export-btn ' + INJECTED;
    mdBtn.textContent = '导出 Markdown';
    mdBtn.setAttribute('aria-label', '导出已选内容为 Markdown');
    mdBtn.addEventListener('click', () => {
      closeExportDialog();
      exportConversation('md', { onlySelected: true });
    });
    const htmlBtn = document.createElement('button');
    htmlBtn.type = 'button';
    htmlBtn.className = 'doc-export-btn ' + INJECTED;
    htmlBtn.textContent = '导出 HTML';
    htmlBtn.setAttribute('aria-label', '导出已选内容为 HTML');
    htmlBtn.addEventListener('click', () => {
      closeExportDialog();
      exportConversation('html', { onlySelected: true });
    });
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'doc-export-btn doc-export-close ' + INJECTED;
    closeBtn.textContent = '关闭';
    closeBtn.setAttribute('aria-label', '关闭导出格式选择');
    closeBtn.addEventListener('click', closeExportDialog);
    panel.append(title, sub, mdBtn, htmlBtn, closeBtn);
    mask.appendChild(panel);
    mask.addEventListener('mousedown', (e) => {
      if (e.target === mask) closeExportDialog();
    });
    document.body.appendChild(mask);
    if (!exportDialogEscBound) {
      exportDialogEscBound = true;
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' && e.key !== 'Esc') return;
        const m = document.querySelector('#docdeep-export-dialog');
        if (m && m.style.display !== 'none') closeExportDialog();
      }, true);
    }
    return mask;
  }
  function openExportDialog() {
    const mask = ensureExportDialog();
    try {
      const selN = selectedQKeys === null ? qOrder.length : selectedQKeys.size;
      const sub = mask.querySelector('.doc-export-dialog-sub');
      if (sub) sub.textContent = `仅导出已勾选内容（${selN}/${qOrder.length}）`;
    } catch {}
    mask.style.display = 'flex';
    try { mask.querySelector('.doc-export-btn')?.focus?.(); } catch {}
  }
  function closeExportDialog() {
    try { document.querySelector('#docdeep-export-dialog')?.style.setProperty('display', 'none'); } catch {}
  }

  // Phase-3: 勾选栏(全选/清空/导出选中),挂载于补全按钮下、列表上,随大纲摘除
  function ensureSelBar(b) {
    let bar = b.querySelector('.doc-ol-selbar');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.className = 'doc-ol-selbar ' + INJECTED;
    const mk = (label, aria, fn) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'doc-ol-selbtn';
      btn.textContent = label;
      btn.setAttribute('aria-label', aria);
      btn.addEventListener('click', fn);
      return btn;
    };
    const all = mk('全选', '全选所有提问', () => { selectedQKeys = new Set(qOrder); outlineDirty = true; buildOutline(); });
    const none = mk('清空', '清空已选提问', () => { selectedQKeys = new Set(); outlineDirty = true; buildOutline(); });
    const exp = mk('导出选中', '选择导出格式,仅导出已选提问', () => { openExportDialog(); });
    exp.classList.add('doc-ol-sel-export');
    bar.append(all, none, exp);
    const lst = b.querySelector('.doc-ol-list');
    if (lst) b.insertBefore(bar, lst);
    else b.appendChild(bar);
    return bar;
  }

  function buildOutline() {
    if (!isOn() || !settings.docdeep_outline) {
      document.querySelector('#docdeep-outline')?.remove();
      return;
    }
    const turns = [...document.querySelectorAll('[data-docturn]')];
    if (turns.length) {
      // 大纲打开时也先对账一次, 避免“回到顶部后顺序错”依赖下一次 classify
      const reg = updateQuestionRegistry(turns);
      if (reg.orderChanged || reg.infoChanged) {
        renumberQuestions(turns);
        lastTurnOrder = turns;
        outlineDirty = true;
      }
    }
    if (!qOrder.length && turns.length < 1) {
      document.querySelector('#docdeep-outline')?.remove();
      olReg = [];
      return;
    }
    // Q 条目来自全局注册表(跨滚动累积的全集, 解决“初始只挂载 Q1/Q2”);
    // 小节标题仍取当前挂载 AI 回答中的 h1/h2/h3, 按其前一个用户问归位到对应 Q 之后。
    const headingsByQ = new Map(); // qKey|'__head' -> [{ el, label, cls }]
    let lastQ = null;
    turns.forEach(el => {
      if (el.getAttribute('data-docrole') === 'user') {
        const text = stripQuestionLabel(cleanTurnText(el));
        if (text) lastQ = keyForTurnEl(el, 'user', text);
        return;
      }
      el.querySelectorAll('.ds-markdown h1, .ds-markdown h2, .ds-markdown h3').forEach(h => {
        const t = (h.innerText || '').trim();
        if (!t || t.length > 42) return;
        const owner = lastQ || '__head';
        if (!headingsByQ.has(owner)) headingsByQ.set(owner, []);
        headingsByQ.get(owner).push({
          el: h,
          label: t,
          cls: h.tagName === 'H1' ? '' : h.tagName === 'H2' ? 'doc-ol-h2' : 'doc-ol-h3',
        });
      });
    });
    const items = [];
    (headingsByQ.get('__head') || []).forEach(h => items.push({ ...h, key: null, owner: '__head' }));
    qOrder.forEach((key, idx) => {
      const info = qInfo.get(key);
      const n = idx + 1;
      const snippet = questionSnippet(info?.text || '');
      const label = snippet ? `Q${n} · ${snippet}` : `Q${n} · 我的提问`;
      items.push({
        key,
        el: liveElByKey.get(key) || null,
        label,
        title: (info?.text || '').slice(0, 120) || label,
        cls: 'doc-ol-q',
        pending: !liveElByKey.get(key),
      });
      (headingsByQ.get(key) || []).forEach(h => items.push({ ...h, key: null, owner: key }));
    });
    // 兜底: 挂载了但尚未入库的标题(流式瞬间)直接追加, 避免漏节
    headingsByQ.forEach((list, owner) => {
      if (owner === '__head' || qOrder.includes(owner)) return;
      list.forEach(h => items.push({ ...h, key: null, owner }));
    });
    const box = ensureOutlineShell();
    const list = box.querySelector('.doc-ol-list');
    // 只要汇总出至少 1 条(单个 Q 也算)即显示面板; 0 条才隐藏。
    if (items.length < 1) {
      list.textContent = '';
      list.dataset.signature = '';
      olReg = [];
      outlineDirty = false;
      box.style.display = 'none';
      return;
    }
    box.style.display = '';
    // 原生目录核对: 只读显示“已加载 M/N”, 编号仍以 qOrder 为准(原生结构未确认前不拿它重排)。
    try {
      const native = probeNativeOutline();
      const head = box.querySelector('h4 span');
      if (head) {
        if (native.found && native.count > 0) {
          const a = alignNativeWithRegistry(native.labels);
          box.dataset.nativeTotal = String(native.count);
          box.dataset.nativeMatched = String(a.matched);
          if (a.matched > 0 && native.count > qOrder.length) {
            head.textContent = `本文大纲（已加载 ${qOrder.length}/${native.count}）`;
            head.title = `原生目录 ${native.count} 项已对上 ${a.matched} 项${a.consistent ? '' : '（顺序不一致，以实际对话为准）'}，滚动后自动补齐`;
          } else {
            head.textContent = '本文大纲';
            head.removeAttribute('title');
          }
        } else {
          head.textContent = '本文大纲';
          head.removeAttribute('title');
          delete box.dataset.nativeTotal;
          delete box.dataset.nativeMatched;
        }
      }
    } catch {}
    // Phase-2: 补全按钮三态(补全运行中由 completeOutline 接管文案, 此处跳过避免打架)
    try {
      if (!outlineComplete) {
        const completeBtn = box.querySelector('.doc-ol-complete');
        if (completeBtn) {
          let nativeCount = 0;
          try {
            const n = probeNativeOutline();
            if (n && n.found && Number(n.count) > 0) nativeCount = Number(n.count);
          } catch {}
          if (nativeCount > 0 && qOrder.length >= nativeCount) {
            completeBtn.textContent = `已全部加载（${nativeCount}）`;
            completeBtn.disabled = true;
          } else if (nativeCount > 0) {
            completeBtn.textContent = `补全未加载（${qOrder.length}/${nativeCount}）`;
            completeBtn.disabled = false;
          } else {
            completeBtn.textContent = '滚动补全全部';
            completeBtn.disabled = false;
          }
        }
      }
    } catch {}
    // Phase-3: 勾选栏计数(未触碰视为全量);空 qOrder 时禁用导出选中
    try {
      const bar = box.querySelector('.doc-ol-selbar');
      if (bar) {
        const selN = selectedQKeys === null ? qOrder.length : selectedQKeys.size;
        bar.querySelectorAll('.doc-ol-selbtn').forEach(b => {
          if (b.classList.contains('doc-ol-sel-export')) {
            b.textContent = `导出选中（${selN}/${qOrder.length}）`;
            b.disabled = !qOrder.length;
          }
        });
      }
    } catch {}
    // 全量签名: 含稳定 key + 全局编号 + 标题文本 + 顺序, 条数/总长度不变但换序/替字也能检出
    // Task3: 追加过滤词, 仅显示层隐藏, olReg 保持全量, M/N 头逻辑复用上段不改算法
    // Phase-3: 追加选中签名 |s:(null记all,否则按qOrder顺序0/1串)
    const filter = ((box.querySelector('.doc-ol-filter')?.value || '').trim().toLowerCase());
    const selSig = selectedQKeys === null ? 'all' : qOrder.map(k => (selectedQKeys.has(k) ? '1' : '0')).join('');
    const matchItem = (it) => {
      if (!filter) return true;
      if (it.key) return ((it.label || '') + '\n' + (it.title || '')).toLowerCase().includes(filter);
      return (it.label || '').toLowerCase().includes(filter);
    };
    const signature = items.map(i => (i.key ? `q:${i.key}:${i.label}` : `h:${i.cls}:${i.label}`)).join('|') + '|f:' + filter + '|s:' + selSig;
    if (!outlineDirty && list.dataset.signature === signature) return;
    list.dataset.signature = signature;
    list.innerHTML = '';
    olReg = [];
    let visibleCount = 0;
    items.slice(0, 100).forEach(it => {
      const show = matchItem(it);
      // Phase-3: Q 行用容器(div)包复选框+按钮(button 不可嵌 input,故改结构);h 行保持单 button
      if (it.key) {
        const row = document.createElement('div');
        row.className = 'doc-ol-row';
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.className = 'doc-ol-check ' + INJECTED;
        const qn = qNumberOf(it.key);
        check.checked = selectedQKeys === null ? true : selectedQKeys.has(it.key);
        check.setAttribute('aria-label', `选择 Q${qn}`);
        check.addEventListener('click', (e) => { e.stopPropagation(); });
        ['keydown', 'keypress', 'keyup'].forEach(t => check.addEventListener(t, (e) => { e.stopPropagation(); }));
        check.addEventListener('change', () => {
          if (selectedQKeys === null) selectedQKeys = new Set(qOrder);
          if (check.checked) selectedQKeys.add(it.key);
          else selectedQKeys.delete(it.key);
          outlineDirty = true;
          buildOutline();
        });
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'doc-ol-item ' + it.cls;
        b.textContent = it.label;
        b.title = it.pending
          ? `${it.title}（不在当前视图，点击自动滚动定位）`
          : (it.title || it.label);
        if (it.pending) b.classList.add('doc-ol-pending');
        if (!show) row.style.display = 'none';
        else visibleCount++;
        b.addEventListener('click', () => {
          box.classList.remove('doc-ol-mobile-open');
          const live = liveElByKey.get(it.key);
          if (live && live.isConnected) live.scrollIntoView({ behavior: 'smooth', block: 'start' });
          else scrollToStoredQuestion(it.key);
        });
        row.append(check, b);
        list.appendChild(row);
        olReg.push({ el: it.el || liveElByKey.get(it.key) || null, btn: b, key: it.key || null });
        return;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'doc-ol-item ' + it.cls;
      b.textContent = it.label;
      b.title = it.key && it.pending
        ? `${it.title}（不在当前视图，点击自动滚动定位）`
        : (it.title || it.label);
      if (it.key && it.pending) b.classList.add('doc-ol-pending');
      if (!show) b.style.display = 'none';
      else visibleCount++;
      b.addEventListener('click', () => {
        box.classList.remove('doc-ol-mobile-open');
        if (!it.key) {
          it.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
        const live = liveElByKey.get(it.key);
        if (live && live.isConnected) live.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else scrollToStoredQuestion(it.key);
      });
      list.appendChild(b);
      olReg.push({ el: it.el || liveElByKey.get(it.key) || null, btn: b, key: it.key || null });
    });
    if (!visibleCount) {
      const empty = document.createElement('div');
      empty.className = 'doc-ol-empty ' + INJECTED;
      empty.textContent = '无匹配，换个关键词试试';
      list.appendChild(empty);
    }
    outlineDirty = false;
    scheduleSpy();
  }
