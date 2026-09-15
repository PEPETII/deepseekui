'use strict';

  // ---- 外壳探测: 顶栏 / 左侧栏 ----
  // DeepSeek 用 css-modules 哈希类名, 标准语义标签(aside/header)不可靠;
  // 已确认 the-header 为硬编码稳定类名。命中即打 data-docshell, 随 setOn(false) 摘除。
  let shellCache = { at: 0, header: null, side: null };
  const SHELL_TTL = 3000;

  function ancestorsOf(n) {
    const arr = [];
    while (n && n !== document.documentElement) { arr.push(n); n = n.parentElement; }
    return arr;
  }
  function lowestCommonAncestor(a, b) {
    if (!a || !b) return a || b;
    const pa = ancestorsOf(a), pb = ancestorsOf(b);
    const setB = new Set(pb);
    for (const n of pa) if (setB.has(n)) return n;
    return null;
  }
  function vpSize() { return { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight }; }
  function isChatHref(href) {
    return /\/(?:a\/)?chat\/(?:s\/)?[0-9a-zA-Z_-]{3,}(?:[/?#]|$)/i.test(String(href || ''));
  }
  function looksLikeSidebar(n) {
    const r = n.getBoundingClientRect();
    const v = vpSize();
    return r.left <= v.w * 0.4 && r.height >= v.h * 0.45 && r.width <= 520 && r.width >= 120;
  }
  function upToSidebar(start) {
    let n = start;
    while (n && n !== document.documentElement) {
      if (looksLikeSidebar(n)) return n;
      n = n.parentElement;
    }
    return looksLikeSidebar(start) ? start : null;
  }
  // 从带内联 --sidebar-width 的容器下钻, 找到宽度≈该值、贴左、够高的真实面板节点
  function findSidebarPanelFromVar() {
    const wraps = [...document.querySelectorAll('[style*="--sidebar-width"]')];
    for (const wrap of wraps) {
      const m = (wrap.getAttribute('style') || '').match(/--sidebar-width:\s*(\d+)px/);
      const w = m ? parseInt(m[1], 10) : null;
      if (!w) continue;
      let best = null, bestH = -1;
      const walk = (el) => {
        for (const c of el.children) {
          const r = c.getBoundingClientRect();
          if (r.left <= 8 && Math.abs(r.width - w) <= 40 && r.height >= vpSize().h * 0.4) {
            if (r.height > bestH) { bestH = r.height; best = c; }
          }
          walk(c);
        }
      };
      walk(wrap);
      if (best) return best;
      if (looksLikeSidebar(wrap)) return wrap; // 容器自身即面板
    }
    return null;
  }
  // 当前构建可能没有 aside/nav，也可能把会话项做成普通 div; 用几何+内容密度作最后回退。
  function findSidebarPanelByGeometry() {
    const v = vpSize();
    if (v.w <= 0 || v.h <= 0) return null;
    const maxW = Math.min(520, Math.max(180, v.w * 0.8));
    const minH = Math.max(320, v.h * 0.55);
    let best = null;
    document.querySelectorAll('div, section, nav, aside').forEach(n => {
      if (n.id?.startsWith('docdeep-') || n.closest?.('#docdeep-dock')) return;
      const r = n.getBoundingClientRect();
      if (r.left > 16 || r.top > 120 || r.width < 56 || r.width > maxW || r.height < minH) return;
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const controls = n.querySelectorAll('a, button, [role="link"], [role="button"]').length;
      const items = n.querySelectorAll('li').length;
      const text = (n.textContent || '').slice(0, 2000);
      const hasSidebarHint = /新对话|天内|日内|today|days?/i.test(text);
      if (!hasSidebarHint && controls < 2 && items < 3 && n.children.length < 4) return;
      const score = (r.left <= 2 ? 24 : 0)
        + (r.top <= 2 ? 18 : 0)
        + (r.height >= v.h * 0.85 ? 38 : 0)
        + (/fixed|sticky/.test(cs.position) ? 24 : 0)
        + (hasSidebarHint ? 48 : 0)
        + Math.min(controls, 10) * 3
        + Math.min(items, 10)
        + Math.min(n.children.length, 10);
      if (!best || score > best.score || (score === best.score && r.height > best.rect.height)) {
        best = { el: n, rect: r, score };
      }
    });
    return best?.el || null;
  }
  function probeHeaderEl() {
    const byClass = document.querySelector('[class~="the-header"]');
    if (byClass) return byClass;
    const v = vpSize();
    let best = null, bestTop = Infinity;
    document.querySelectorAll('header, div').forEach(n => {
      const cs = getComputedStyle(n);
      if (!/fixed|sticky/.test(cs.position)) return;
      const r = n.getBoundingClientRect();
      if (r.top > 8 || r.width < v.w * 0.6 || r.height < 24 || r.height > 110) return;
      if (r.top < bestTop) { bestTop = r.top; best = n; }
    });
    return best || document.querySelector('header');
  }
  function probeSideEl() {
    // 策略1: 内联 --sidebar-width (DeepSeek 硬编码变量) -> 下钻到真实面板
    const fromVar = findSidebarPanelFromVar();
    if (fromVar) return fromVar;
    // 策略2: 会话链接最近公共祖先(LCA)。链接可能是 <a> 或任意带 /chat/ 路径的元素
    const chatLinks = [...document.querySelectorAll('a, [href]')].filter(a => {
      const h = a.getAttribute('href') || '';
      return isChatHref(h);
    });
    if (chatLinks.length >= 1) {
      let lca = chatLinks[0];
      for (const a of chatLinks) { const x = lowestCommonAncestor(lca, a); if (x) lca = x; }
      const s = upToSidebar(lca);
      if (s) return s;
    }
    // 策略3: <aside> 语义标签 + 左侧几何约束, 避免误命中右侧目录
    const asides = [...document.querySelectorAll('aside')].filter(n => {
      const r = n.getBoundingClientRect();
      const v = vpSize();
      return r.left <= v.w * 0.4 && r.width > 0 && r.width <= 520 && r.height >= v.h * 0.25;
    });
    if (asides.length) {
      return asides.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0];
    }
    // 策略4: nav / role=navigation 几何回退
    const v = vpSize();
    let best = null, bestH = -1;
    document.querySelectorAll('nav, [role="navigation"]').forEach(n => {
      const r = n.getBoundingClientRect();
      if (r.left > v.w * 0.4 || r.height < v.h * 0.4 || r.width > 520 || r.width < 120) return;
      if (r.height > bestH) { bestH = r.height; best = n; }
    });
    if (best) return best;
    // 策略5: 无语义标签的长左栏(当前构建的常见形态)
    return findSidebarPanelByGeometry();
  }
  function probeShell() {
    if (!isOn()) return;
    const now = Date.now();
    const need = !shellCache.at
      || (shellCache.header && !shellCache.header.isConnected)
      || (shellCache.side && !shellCache.side.isConnected)
      || now - shellCache.at > SHELL_TTL;
    if (!need) return;
    const h = probeHeaderEl();
    const s = probeSideEl();
    if (h && h.getAttribute('data-docshell') !== 'header') h.setAttribute('data-docshell', 'header');
    if (s && s.getAttribute('data-docshell') !== 'side') s.setAttribute('data-docshell', 'side');
    shellCache = { at: now, header: h, side: s };
  }

  function scrollContainer() {
    return document.querySelector('.ds-virtual-list')
      || document.querySelector('.ds-virtual-list-visible-items')
      || document.scrollingElement || document.documentElement;
  }

  // v0.3.4-ui: 右下悬浮栈(查找面板在上、工具条在下), 避免固定定位互相重叠
  function ensureDock() {
    let dock = document.querySelector('#docdeep-dock');
    if (dock) return dock;
    dock = document.createElement('div');
    dock.id = 'docdeep-dock';
    dock.className = INJECTED;
    document.body.appendChild(dock);
    return dock;
  }

  function ensureTools() {
    if (document.querySelector('#docdeep-tools')) return;
    const bar = document.createElement('div');
    bar.id = 'docdeep-tools';
    bar.className = INJECTED;
    const mainRow = document.createElement('div');
    mainRow.className = 'doc-tools-row doc-tools-row--main ' + INJECTED;
    const tools = document.createElement('button');
    tools.type = 'button';
    tools.textContent = '回到顶部';
    tools.title = '回到会话开头';
    tools.addEventListener('click', scrollTop);
    const find = document.createElement('button');
    find.type = 'button';
    find.textContent = '查找';
    find.title = '查找当前会话 (Ctrl/Cmd+Shift+F)';
    find.addEventListener('click', openFind);
    const outline = document.createElement('button');
    outline.type = 'button';
    outline.textContent = '目录';
    outline.title = '显示 / 隐藏右侧大纲';
    outline.addEventListener('click', toggleOutlinePanel);
    mainRow.append(tools, find, outline);
    bar.append(mainRow);

    const meta = document.createElement('div');
    meta.className = 'doc-tools-meta ' + INJECTED;
    const ver = document.createElement('span');
    ver.id = 'docdeep-ver';
    ver.className = INJECTED;
    ver.textContent = 'deepseek ui v' + VERSION;
    ver.title = '扩展内容脚本版本(对不上 popup 版本即需重载扩展)';
    const count = document.createElement('span');
    count.id = 'docdeep-count';
    count.className = INJECTED;
    count.textContent = '0 字';
    count.title = '当前输入框字数';
    meta.append(ver, count);
    bar.appendChild(meta);

    ensureDock().appendChild(bar);
  }

  function scrollTop() {
    const c = scrollContainer();
    try { c.scrollTo({ top: 0, behavior: 'smooth' }); }
    catch { c.scrollTop = 0; }
  }
