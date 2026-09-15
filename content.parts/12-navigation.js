'use strict';
  // ---- Phase-2 键盘导航 + 一键补全(只读滚动, 未挂载复用单例 scrollToStoredQuestion, 无第二套滚动) ----
  function keysHelpOutside(e) {
    try {
      if (e.target && e.target.closest && e.target.closest('#docdeep-keys-help')) return;
    } catch {}
    toggleKeysHelp(false);
  }
  // 复用 spy 口径(top<=140 取最后命中); 无命中按滚动位/首个挂载兜底; qOrder 空返回 -1
  function getCurrentQIndex() {
    if (!qOrder.length) return -1;
    let cur = -1;
    for (let i = 0; i < qOrder.length; i++) {
      try {
        const el = liveElByKey.get(qOrder[i]);
        if (!el || !el.isConnected) continue;
        if (el.getBoundingClientRect().top <= 140) cur = i;
      } catch {}
    }
    if (cur >= 0) return cur;
    try {
      const c = scrollContainer();
      if ((Number(c.scrollTop) || 0) <= 2) return -1;
    } catch {}
    for (let i = 0; i < qOrder.length; i++) {
      try {
        const el = liveElByKey.get(qOrder[i]);
        if (el && el.isConnected) return i - 1;
      } catch {}
    }
    return -1;
  }
  function jumpQ(step) {
    if (!qOrder.length) { toast('暂无大纲，先滚动加载'); return; }
    if (exportState || outlineComplete) { toast('任务进行中，稍后再试'); return; }
    const cur = getCurrentQIndex();
    const target = cur + step;
    if (target < 0) { toast('已是首个提问'); return; }
    if (target >= qOrder.length) { toast('已是末个提问'); return; }
    const key = qOrder[target];
    const live = liveElByKey.get(key);
    if (live && live.isConnected) {
      try { live.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      catch { try { live.scrollIntoView(); } catch {} }
    } else {
      scrollToStoredQuestion(key);
    }
  }
  function toggleKeysHelp(force) {
    const existing = document.querySelector('#docdeep-keys-help');
    const wantOpen = typeof force === 'boolean' ? force : !existing;
    if (!wantOpen) {
      try { if (existing) existing.remove(); } catch {}
      document.removeEventListener('mousedown', keysHelpOutside, true);
      return;
    }
    if (existing) {
      try { existing.remove(); } catch {}
      document.removeEventListener('mousedown', keysHelpOutside, true);
      return;
    }
    const box = document.createElement('div');
    box.id = 'docdeep-keys-help';
    box.className = INJECTED;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', '键盘导航帮助');
    const title = document.createElement('div');
    title.className = 'doc-keys-title';
    title.textContent = '键盘导航（输入框内禁用）';
    const list = document.createElement('ul');
    list.className = 'doc-keys-list';
    [
      ['J', '下一个提问'],
      ['K', '上一个提问'],
      ['?', '打开 / 关闭本帮助'],
      ['Esc', '关闭本帮助'],
      ['Ctrl+Shift+F', '查找当前会话'],
      ['Alt+Shift+D', '开 / 关文档版式'],
      ['Alt+Shift+C', '复制全文'],
    ].forEach(([k, desc]) => {
      const li = document.createElement('li');
      const kbd = document.createElement('kbd');
      kbd.textContent = k;
      const span = document.createElement('span');
      span.textContent = ' ' + desc;
      li.append(kbd, span);
      list.appendChild(li);
    });
    const tip = document.createElement('div');
    tip.className = 'doc-keys-tip';
    tip.textContent = '在输入框、文本框内按键不触发；J/K 按大纲全局顺序跳转，未加载的提问会自动滚动定位。';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'doc-keys-close';
    close.textContent = '关闭';
    close.setAttribute('aria-label', '关闭键盘帮助');
    close.addEventListener('click', () => toggleKeysHelp(false));
    box.append(title, list, tip, close);
    document.body.appendChild(box);
    setTimeout(() => {
      try { document.addEventListener('mousedown', keysHelpOutside, true); } catch {}
    }, 0);
  }
  async function completeOutline() {
    if (outlineComplete) { outlineComplete.cancelled = true; return; }
    if (exportState) { toast('导出采集中，稍后再补全'); return; }
    if (!isOn()) return;
    outlineSearchToken++;
    const token = { cancelled: false };
    outlineComplete = token;
    const box = ensureOutlineShell();
    const btn = box.querySelector('.doc-ol-complete');
    const paintBtn = (text, disabled) => {
      if (!btn) return;
      btn.textContent = text;
      btn.disabled = !!disabled;
    };
    paintBtn('补全中…点击取消', false);
    const container = scrollContainer();
    const initialTop = Number(container.scrollTop) || 0;
    const viewport = Math.max(240, Number(container.clientHeight) || window.innerHeight || 600);
    const step = Math.max(240, Math.floor(viewport * 0.8));
    let nativeCount = 0;
    try {
      const n = probeNativeOutline();
      if (n && n.found && Number(n.count) > 0) nativeCount = Number(n.count);
    } catch {}
    try {
      scrollToExact(container, 0);
      await wait(160);
      if (token.cancelled || !isOn()) throw new Error('cancelled');
      if (exportState) throw new Error('busy');
      classify();
      let top = Number(container.scrollTop) || 0;
      let stable = 0;
      let prev = qOrder.length;
      paintBtn(nativeCount > 0 ? `补全中 ${qOrder.length}/约${nativeCount}…` : `补全中 ${qOrder.length}…`, false);
      for (let i = 0; i < 320; i++) {
        if (token.cancelled || !isOn()) throw new Error('cancelled');
        if (exportState) throw new Error('busy');
        const maxTop = Math.max(0, (Number(container.scrollHeight) || 0) - viewport);
        if (top >= maxTop - 2) {
          if (qOrder.length === prev) stable++;
          else { stable = 0; prev = qOrder.length; }
          if (stable >= 2) break;
          await wait(140);
          if (token.cancelled) throw new Error('cancelled');
          classify();
          top = Number(container.scrollTop) || top;
          continue;
        }
        stable = 0;
        top = Math.min(maxTop, top + step);
        scrollToExact(container, top);
        await wait(130);
        if (token.cancelled) throw new Error('cancelled');
        classify();
        prev = qOrder.length;
        if (i % 2 === 0) paintBtn(nativeCount > 0 ? `补全中 ${qOrder.length}/约${nativeCount}…` : `补全中 ${qOrder.length}…`, false);
      }
      outlineDirty = true;
      try { buildOutline(); } catch {}
      toast(`补全完成，共 ${qOrder.length} 个提问`);
    } catch (err) {
      if (err && err.message === 'busy') toast('导出采集中，补全已停止');
      else toast('补全已取消');
    } finally {
      try { scrollToExact(container, initialTop); } catch {}
      await wait(40);
      outlineComplete = null;
      try { outlineDirty = true; buildOutline(); } catch {}
    }
  }

  // 点击大纲中“已记录但当前未挂载”的提问: 按其全局位置定向滚动查找并定位。
  // 只读滚动 + 复用 classify 对账, 不触碰原文与发送链路。
  async function scrollToStoredQuestion(key) {
    if (exportState) { toast('导出采集中，稍后再定位'); return; }
    const token = ++outlineSearchToken;
    const targetIdx = qOrder.indexOf(key);
    if (targetIdx < 0) { toast('该提问暂未记录，可滚动加载后重试'); return; }
    const container = scrollContainer();
    const viewport = Math.max(240, Number(container.clientHeight) || window.innerHeight || 600);
    const step = Math.max(240, Math.floor(viewport * 0.8));
    const at = (el) => { try { el.scrollIntoView({ behavior: 'auto', block: 'start' }); } catch {} };
    toast(`正在定位 Q${targetIdx + 1}…`);
    const mountedIdx = [...liveElByKey.keys()].map(k => qOrder.indexOf(k)).filter(i => i >= 0);
    const minMounted = mountedIdx.length ? Math.min(...mountedIdx) : -1;
    const maxMounted = mountedIdx.length ? Math.max(...mountedIdx) : -1;
    let dir = 0; // -1 向上找更早, +1 向下找更新
    if (minMounted >= 0 && targetIdx < minMounted) dir = -1;
    else if (maxMounted >= 0 && targetIdx > maxMounted) dir = 1;
    else dir = targetIdx <= qOrder.length / 2 ? -1 : 1;
    const maxTop = () => Math.max(0, (Number(container.scrollHeight) || 0) - viewport);
    try {
      if (dir < 0) {
        scrollToExact(container, 0);
        await wait(160);
        if (token !== outlineSearchToken) return;
        classify();
        for (let i = 0; i < 160; i++) {
          const live = liveElByKey.get(key);
          if (live && live.isConnected) { at(live); outlineSearchToken++; return; }
          if (token !== outlineSearchToken || exportState) return;
          const max = maxTop();
          let top = Number(container.scrollTop) || 0;
          if (top >= max - 2) break;
          scrollToExact(container, Math.min(max, top + step));
          await wait(130);
          if (token !== outlineSearchToken) return;
          classify();
        }
      } else {
        scrollToExact(container, maxTop());
        await wait(160);
        if (token !== outlineSearchToken) return;
        classify();
        for (let i = 0; i < 160; i++) {
          const live = liveElByKey.get(key);
          if (live && live.isConnected) { at(live); outlineSearchToken++; return; }
          if (token !== outlineSearchToken || exportState) return;
          let top = Number(container.scrollTop) || 0;
          if (top <= 2) break;
          scrollToExact(container, Math.max(0, top - step));
          await wait(130);
          if (token !== outlineSearchToken) return;
          classify();
        }
      }
      const live = liveElByKey.get(key);
      if (live && live.isConnected) { at(live); }
      else toast('未找到该提问，可能还未加载，可先滚动浏览一遍');
    } finally {
      if (token === outlineSearchToken) outlineSearchToken++;
    }
  }

  // 当前节高亮: 只读位置 + 只改注入按钮类名
  function spy() {
    if (!isOn() || !olReg.length) return;
    const box = document.querySelector('#docdeep-outline');
    if (!box || box.style.display === 'none') return;
    let cur = -1;
    for (let i = 0; i < olReg.length; i++) {
      try {
        // Task3: 跳过过滤隐藏项(仅显示层 display:none, olReg 仍全量)
        // Phase-3: Q 行容器隐藏时 button 自身无 display,需看父行
        const btn = olReg[i].btn;
        if (!btn) continue;
        const hidden = btn.style.display === 'none'
          || (btn.parentElement?.classList?.contains('doc-ol-row') && btn.parentElement.style.display === 'none');
        if (hidden) continue;
        const el = olReg[i].key ? liveElByKey.get(olReg[i].key) : olReg[i].el;
        if (!el || !el.isConnected) continue;
        if (el.getBoundingClientRect().top <= 140) cur = i;
      } catch {}
    }
    olReg.forEach((r, i) => r.btn.classList.toggle('active', i === cur));
  }
  function scheduleSpy() {
    if (spyScheduled) return;
    spyScheduled = true;
    setTimeout(() => { spyScheduled = false; spy(); }, 250);
  }

  function scheduleOutline() {
    if (outlineScheduled) return;
    outlineScheduled = true;
    setTimeout(() => { outlineScheduled = false; buildOutline(); }, 400);
  }

  function classify() {
    if (!isOn()) return;
    const urlChanged = location.href !== lastUrl;
    if (urlChanged) {
      removeFormattingToolbar();
      lastUrl = location.href;
      qOrder = [];
      qInfo = new Map();
      liveElByKey = new Map();
      outlineSearchToken++;
      lastTurnOrder = [];
      outlineDirty = true;
      // Phase-3: 选中态与 qOrder 同命,URL 切换即清空
      selectedQKeys = null;
    }
    probeShell();
    applyNativeNavHide(); // NATIVE-NAV-HIDE-001: 容器重挂后每轮重打标(探测 5s 缓存)
    try { document.querySelectorAll('.doc-search').forEach(n => n.remove()); } catch {}
    ensureTools();
    ensureFormattingToolbar();
    // Q-INFLATE-001: 去嵌套在 queryTurns() 内统一处理
    const turns = queryTurns();
    let turnChanged = false;
    turns.forEach(el => {
      const text = turnText(el);
      const role = isUserTurn(el, text) ? 'user' : 'assistant';
      const fingerprint = hashText(text);
      const previousRole = el.getAttribute('data-docrole');
      const previousFingerprint = el.getAttribute('data-docfp');
      const firstSeen = !el.getAttribute('data-docturn');
      const changedRole = !!previousRole && previousRole !== role;
      const changedUserText = role === 'user'
        && !!previousFingerprint
        && previousFingerprint !== fingerprint;
      if (firstSeen || changedRole || changedUserText) {
        if (!firstSeen) resetTurn(el);
        turnChanged = true;
        el.setAttribute('data-docturn', '1');
        el.setAttribute('data-docrole', role);
        el.setAttribute('data-docfp', fingerprint);
        if (role === 'user') tagUser(el);
        else tagThink(el);
      } else {
        el.setAttribute('data-docfp', fingerprint);
        if (role === 'user') tagUser(el);
        else tagThink(el);
      }
    });
    const orderChanged = turns.length !== lastTurnOrder.length
      || turns.some((el, index) => el !== lastTurnOrder[index]);
    const reg = updateQuestionRegistry(turns);
    // Q-INFLATE-001 自愈: 本轮前已污染的赝 Q(旧版本误入)就地摘除, 无需刷新
    const pruned = pruneBogusQuestions();
    if (urlChanged || turnChanged || orderChanged || reg.orderChanged || reg.infoChanged || pruned) {
      renumberQuestions(turns);
      lastTurnOrder = turns;
      outlineDirty = true;
    }
    const ta = document.querySelector('textarea');
    if (ta && !ta.dataset.docPh) {
      ta.dataset.docPh = '1';
      ta.dataset.docOriginalPlaceholder = ta.placeholder || '';
      if (!ta.placeholder || /Ask|Message|Send/i.test(ta.placeholder)) ta.placeholder = '在此继续写作或追问,回车发送…';
    }
    scheduleOutline();
    if (findState.open) refreshFindResults();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; classify(); }, 120);
  }

  // 输入字数(事件委托,不碰原节点)
  document.addEventListener('input', (e) => {
    if (e.target?.tagName === 'TEXTAREA') {
      const c = document.querySelector('#docdeep-count');
      if (c) c.textContent = (e.target.value || '').length + ' 字';
    }
  });

  function isEditableTarget(target) {
    return !!target?.closest?.('textarea, input, [contenteditable="true"]');
  }

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || isEditableTarget(e.target)) return;
    const key = String(e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'f') {
      e.preventDefault();
      openFind();
      return;
    }
    if (e.altKey && e.shiftKey && key === 'd') {
      e.preventDefault();
      const on = !isOn();
      chrome.storage.local.set({ docdeep_enabled: on });
      setOn(on);
      if (on) classify();
    }
    if (e.altKey && e.shiftKey && key === 'c') {
      e.preventDefault();
      copyFull().then(ok => toast(ok ? '全文已复制,可粘贴到笔记' : '复制失败,请手动选择复制'));
      return;
    }
    // Phase-2: J/K/? 仅扩展开且总闸开时生效, 有 ctrl/meta/alt 即忽略; 旧三键在上方已处理, 不受总闸影响
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!isOn() || settings.docdeep_keys === false) return;
    if (key === 'j') { jumpQ(1); return; }
    if (key === 'k') { jumpQ(-1); return; }
    if (key === '?') { e.preventDefault(); toggleKeysHelp(); return; }
    if (key === 'escape' && document.querySelector('#docdeep-keys-help')) { toggleKeysHelp(false); }
  });
