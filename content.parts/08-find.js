'use strict';

  function ensureFindPanel() {
    let panel = document.querySelector('#docdeep-find');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'docdeep-find';
    panel.className = INJECTED;

    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = '查找当前会话(已加载内容)';
    input.setAttribute('aria-label', '查找当前会话');
    input.addEventListener('input', () => {
      findState.keyword = input.value.trim();
      findState.index = -1;
      refreshFindResults({ scrollToFirst: true });
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        moveFind(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        closeFind();
      }
    });

    const count = document.createElement('span');
    count.className = 'doc-find-count';
    count.textContent = '0/0';
    const previous = document.createElement('button');
    previous.type = 'button';
    previous.textContent = '↑';
    previous.title = '上一个结果';
    previous.addEventListener('click', () => moveFind(-1));
    const next = document.createElement('button');
    next.type = 'button';
    next.textContent = '↓';
    next.title = '下一个结果';
    next.addEventListener('click', () => moveFind(1));
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.title = '关闭查找 (Esc)';
    close.setAttribute('aria-label', '关闭查找');
    close.addEventListener('click', closeFind);
    panel.append(input, count, previous, next, close);
    // v0.3.4-ui: 挂入右下悬浮栈并置顶, 始终位于工具条上方
    const dock = ensureDock();
    dock.insertBefore(panel, dock.firstChild);
    return panel;
  }

  function openFind() {
    const panel = ensureFindPanel();
    findState.open = true;
    panel.style.display = 'flex';
    refreshFindResults();
    panel.querySelector('input')?.focus();
  }

  function closeFind() {
    try { clearFindHighlights(); } catch {}
    document.querySelector('#docdeep-find')?.style.setProperty('display', 'none');
    findState = { open: false, keyword: '', results: [], index: -1, marks: [] };
  }

  function findHlSupported() {
    try {
      return typeof Highlight !== 'undefined' && !!(window.CSS && window.CSS.highlights);
    } catch { return false; }
  }

  // 完整清理旧高亮: Highlight API + 可逆 <mark> 解包 + 整条命中容器标记, 不碰原文。
  function clearFindHighlights() {
    try {
      if (window.CSS && window.CSS.highlights) {
        window.CSS.highlights.delete(FIND_HL);
        window.CSS.highlights.delete(FIND_HL_ACTIVE);
      }
    } catch {}
    try {
      document.querySelectorAll('.' + FIND_MARK_CLASS).forEach(mark => {
        const parent = mark.parentNode;
        if (!parent) return;
        try {
          const txt = document.createTextNode(mark.textContent || '');
          parent.replaceChild(txt, mark);
          try { parent.normalize(); } catch {}
        } catch {}
      });
    } catch {}
    try {
      document.querySelectorAll('[data-doc-search-hit]').forEach(el => {
        el.removeAttribute('data-doc-search-hit');
        el.classList.remove('doc-search-hit', 'doc-search-active');
      });
    } catch {}
    try {
      document.querySelectorAll('.' + FIND_MARK_ACTIVE).forEach(n => {
        try { n.classList.remove(FIND_MARK_ACTIVE); } catch {}
      });
    } catch {}
  }

  function isSkippedFindNode(node) {
    try {
      const el = node.parentElement;
      if (!el) return true;
      if (el.closest?.('.' + INJECTED + ', #docdeep-find, #docdeep-tools, #docdeep-outline, #docdeep-toast, #docdeep-export-progress, #docdeep-export-dialog, #docdeep-keys-help')) return true;
      if (el.closest?.('.' + FIND_MARK_CLASS)) return true;
      const tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON') {
        // 按钮内的复制/展开文案不参与查找, 避免命中注入按钮
        if (el.closest?.('[data-docturn]')) {
          const inTurnBtn = el.closest('button');
          if (inTurnBtn) return true;
        } else {
          return true;
        }
      }
      if (el.closest?.('.doc-qtag, .doc-expand, .doc-thinkbtn')) return true;
    } catch {}
    return false;
  }

  // 在已挂载 [data-docturn] 内按文本节点逐字匹配, 大小写不敏感, 返回 [{ turn, range }]。
  // 只拆 Text 节点建 Range, 不改 DOM; 中英文/代码块/同一段重复词统一走此口径。
  function collectFindMatches(keyword) {
    const kw = String(keyword || '').trim();
    if (!kw) return [];
    const kwLow = kw.toLocaleLowerCase();
    if (!kwLow) return [];
    const out = [];
    let turns = [];
    try { turns = [...document.querySelectorAll('[data-docturn]')]; } catch { return []; }
    for (const turn of turns) {
      if (!turn || !turn.isConnected) continue;
      let walker = null;
      try {
        walker = document.createTreeWalker(turn, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            try {
              if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
              if (isSkippedFindNode(node)) return NodeFilter.FILTER_REJECT;
              return NodeFilter.FILTER_ACCEPT;
            } catch { return NodeFilter.FILTER_REJECT; }
          }
        });
      } catch { continue; }
      const textNodes = [];
      try {
        let n = walker.nextNode();
        while (n) { textNodes.push(n); n = walker.nextNode(); }
      } catch {}
      for (const tn of textNodes) {
        try {
          if (!tn.isConnected) continue;
          const txt = tn.nodeValue || '';
          if (!txt) continue;
          const low = txt.toLocaleLowerCase();
          let from = 0;
          while (true) {
            const at = low.indexOf(kwLow, from);
            if (at < 0) break;
            try {
              const r = document.createRange();
              const wantEnd = Math.min(at + kwLow.length, txt.length);
              if (wantEnd <= at) break;
              r.setStart(tn, at);
              r.setEnd(tn, wantEnd);
              out.push({ turn, range: r });
            } catch {}
            from = at + Math.max(1, kwLow.length);
            if (from >= low.length) break;
            if (out.length >= FIND_MAX) break;
          }
        } catch {}
        if (out.length >= FIND_MAX) break;
      }
      if (out.length >= FIND_MAX) break;
    }
    return out;
  }

  // 绘制高亮: 容器保留淡提示, 文字本身为主要定位方式(普通浅黄 / 当前更强橙)。
  function paintFindHighlights(matches, activeIdx) {
    try {
      const turnsWith = new Set();
      (matches || []).forEach(m => { if (m && m.turn) turnsWith.add(m.turn); });
      turnsWith.forEach(turn => {
        try {
          if (!turn.isConnected) return;
          turn.setAttribute('data-doc-search-hit', '1');
          turn.classList.add('doc-search-hit');
        } catch {}
      });
      const active = (activeIdx >= 0 && activeIdx < (matches || []).length) ? matches[activeIdx] : null;
      if (active && active.turn && active.turn.isConnected) {
        try { active.turn.classList.add('doc-search-active'); } catch {}
      }
    } catch {}
    if (findHlSupported()) {
      try {
        const live = (matches || []).map(m => m.range).filter(r => {
          try { return r && r.startContainer && r.startContainer.isConnected; } catch { return false; }
        });
        if (live.length) {
          try { window.CSS.highlights.set(FIND_HL, new Highlight(...live)); }
          catch {
            try { window.CSS.highlights.set(FIND_HL, new Highlight(...live.slice(0, 500))); } catch {}
          }
        } else {
          try { window.CSS.highlights.delete(FIND_HL); } catch {}
        }
        const act = (activeIdx >= 0 && activeIdx < (matches || []).length) ? matches[activeIdx].range : null;
        let actLive = false;
        try { actLive = !!(act && act.startContainer && act.startContainer.isConnected); } catch {}
        if (act && actLive) {
          try { window.CSS.highlights.set(FIND_HL_ACTIVE, new Highlight(act)); } catch {}
        } else {
          try { window.CSS.highlights.delete(FIND_HL_ACTIVE); } catch {}
        }
        try { findState.marks = []; } catch {}
        return;
      } catch {}
    }
    // 回退: 单文本节点内从后往前 splitText + <mark> 包裹, 可逆解包, 不跨节点 surround。
    try {
      const byNode = new Map();
      (matches || []).forEach((m, idx) => {
        try {
          const tn = m.range.startContainer;
          if (!tn || tn.nodeType !== 3) return;
          if (!byNode.has(tn)) byNode.set(tn, []);
          byNode.get(tn).push({ idx, start: m.range.startOffset, end: m.range.endOffset });
        } catch {}
      });
      const marks = new Array((matches || []).length).fill(null);
      byNode.forEach((list, tn) => {
        try {
          if (!tn.isConnected) return;
          list.sort((a, b) => b.start - a.start);
          list.forEach(({ idx, start, end }) => {
            try {
              const len = (tn.nodeValue || '').length;
              const s = Math.max(0, Math.min(start, len));
              const e = Math.max(s, Math.min(end, len));
              if (e <= s) return;
              let mid = tn;
              if (e < (tn.nodeValue || '').length) {
                try { tn.splitText(e); } catch {}
              }
              if (s > 0) {
                try { mid = tn.splitText(s); } catch { mid = tn; }
              } else {
                mid = tn;
              }
              if (!mid || !mid.parentNode) return;
              const mark = document.createElement('mark');
              mark.className = FIND_MARK_CLASS;
              mark.setAttribute('data-docdeep-find-mark', '1');
              try {
                mid.parentNode.replaceChild(mark, mid);
                mark.appendChild(mid);
                marks[idx] = mark;
              } catch {}
            } catch {}
          });
        } catch {}
      });
      findState.marks = marks;
      try {
        marks.forEach((mk, i) => {
          if (!mk || !mk.isConnected) return;
          try { mk.classList.toggle(FIND_MARK_ACTIVE, i === activeIdx); } catch {}
        });
      } catch {}
    } catch {}
  }

  // 若当前匹配在折叠的用户问/思考块内, 先展开以保证可见, 仅动折叠类名与按钮文案。
  function ensureFindMatchVisible(match) {
    try {
      const turn = match && match.turn;
      if (!turn || !turn.isConnected) return;
      if (turn.classList.contains('doc-user-collapsed')) {
        turn.classList.remove('doc-user-collapsed');
        try {
          const btn = turn.querySelector('.doc-expand');
          if (btn) btn.textContent = '收起';
        } catch {}
      }
      if (turn.classList.contains('doc-think-collapsed')) {
        turn.classList.remove('doc-think-collapsed');
        try {
          const btn = turn.querySelector('.doc-thinkbtn');
          if (btn) btn.textContent = '思考过程(已展开,点击收起)';
        } catch {}
      }
    } catch {}
  }

  // 以匹配文字为中心滚动(视口中央), 而非整条消息顶部; 虚拟列表容器与文档滚动分别处理。
  function scrollFindMatchIntoView(match) {
    if (!match) return;
    try { ensureFindMatchVisible(match); } catch {}
    try {
      const range = match.range;
      let rect = null;
      try { rect = range.getBoundingClientRect(); } catch {}
      const container = scrollContainer();
      const isDocScroller = (container === document.scrollingElement || container === document.documentElement || container === document.body);
      if (rect && (rect.width !== 0 || rect.height !== 0 || rect.top !== 0)) {
        const vh = window.innerHeight || document.documentElement.clientHeight || 600;
        const delta = (rect.top + rect.height / 2) - vh / 2;
        if (isDocScroller) {
          try { window.scrollBy({ top: delta, behavior: 'smooth' }); }
          catch { try { window.scrollBy(0, delta); } catch {} }
        } else {
          try { container.scrollBy({ top: delta, behavior: 'smooth' }); }
          catch { try { container.scrollTop = (Number(container.scrollTop) || 0) + delta; } catch {} }
        }
        return;
      }
    } catch {}
    try {
      const el = match.turn;
      if (el && el.scrollIntoView) {
        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        catch { try { el.scrollIntoView(); } catch {} }
      }
    } catch {}
  }

  function refreshFindResults(opts) {
    if (!findState.open) return;
    const panel = document.querySelector('#docdeep-find');
    if (!panel) return;
    const input = panel.querySelector('input');
    const count = panel.querySelector('.doc-find-count');
    const keyword = String(input?.value ?? findState.keyword ?? '').trim();
    findState.keyword = keyword;
    try { clearFindHighlights(); } catch {}
    if (!keyword) {
      findState.results = [];
      findState.index = -1;
      findState.marks = [];
      if (count) { count.textContent = '0/0'; count.classList.add('is-empty'); count.title = '暂无匹配'; }
      return;
    }
    let matches = [];
    try { matches = collectFindMatches(keyword); } catch { matches = []; }
    findState.results = matches;
    if (!matches.length) {
      findState.index = -1;
      findState.marks = [];
      if (count) { count.textContent = '0/0'; count.classList.toggle('is-empty', true); count.title = '暂无匹配'; }
      return;
    }
    if (findState.index < 0 || findState.index >= matches.length) findState.index = 0;
    try { paintFindHighlights(matches, findState.index); } catch {}
    if (count) {
      const truncated = matches.length >= FIND_MAX ? '+' : '';
      count.textContent = `${findState.index + 1}/${matches.length}${truncated}`;
      count.classList.toggle('is-empty', false);
      count.title = matches.length >= FIND_MAX
        ? `共 ${matches.length} 处以上匹配(仅高亮前 ${FIND_MAX} 处)`
        : `共 ${matches.length} 处匹配`;
    }
    if (opts && opts.scrollToFirst && matches.length) {
      try { scrollFindMatchIntoView(matches[findState.index]); } catch {}
    }
  }

  function moveFind(step) {
    if (!findState.open) openFind();
    if (!findState.results.length) {
      try { refreshFindResults(); } catch {}
      if (!findState.results.length) return;
    }
    const n = findState.results.length;
    if (!n) return;
    // 若 DOM 流式/回收导致当前 Range 已脱离, 全量重建后再定位, 避免指到旧节点。
    try {
      const cur = findState.results[findState.index];
      if (!cur || !cur.range.startContainer || !cur.range.startContainer.isConnected) {
        const keepKeyword = findState.keyword;
        const keepIdx = findState.index;
        refreshFindResults();
        if (!findState.results.length) return;
        if (keepKeyword === findState.keyword && keepIdx >= 0 && keepIdx < findState.results.length) {
          findState.index = keepIdx;
        }
      }
    } catch {}
    const total = findState.results.length;
    findState.index = (findState.index + step + total) % total;
    const matches = findState.results;
    const activeIdx = findState.index;
    try {
      if (findHlSupported()) {
        try {
          const act = matches[activeIdx] && matches[activeIdx].range;
          if (act && act.startContainer && act.startContainer.isConnected) {
            try { window.CSS.highlights.set(FIND_HL_ACTIVE, new Highlight(act)); } catch {}
          }
        } catch {}
        try {
          document.querySelectorAll('.doc-search-active').forEach(el => {
            try { el.classList.remove('doc-search-active'); } catch {}
          });
          const turn = matches[activeIdx] && matches[activeIdx].turn;
          if (turn && turn.isConnected) {
            try { turn.classList.add('doc-search-active'); } catch {}
          }
        } catch {}
      } else {
        try {
          const marks = (findState.marks && findState.marks.length === matches.length)
            ? findState.marks
            : [...document.querySelectorAll('.' + FIND_MARK_CLASS)];
          marks.forEach((mk, i) => {
            try { if (mk && mk.classList) mk.classList.toggle(FIND_MARK_ACTIVE, i === activeIdx); } catch {}
          });
          document.querySelectorAll('.doc-search-active').forEach(el => {
            try { el.classList.remove('doc-search-active'); } catch {}
          });
          const turn = matches[activeIdx] && matches[activeIdx].turn;
          if (turn && turn.isConnected) {
            try { turn.classList.add('doc-search-active'); } catch {}
          }
        } catch {}
      }
    } catch {}
    try {
      const panel = document.querySelector('#docdeep-find');
      const count = panel && panel.querySelector('.doc-find-count');
      if (count) {
        const truncated = total >= FIND_MAX ? '+' : '';
        count.textContent = `${activeIdx + 1}/${total}${truncated}`;
        count.classList.toggle('is-empty', false);
      }
    } catch {}
    try { scrollFindMatchIntoView(matches[activeIdx]); } catch {}
  }
