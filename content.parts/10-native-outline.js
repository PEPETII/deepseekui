'use strict';
  // ---- 原生目录只读适配(NATIVE-OUTLINE-001, 见 docs/known-issues.md) ----
  // DeepSeek 右侧自带的对话目录(如用户报告的 div._6ffc3c9)是“完整会话”的另一视角:
  // 虚拟列表只挂载子集, 而原生目录通常列出全部提问。只读其文本/顺序做核对,
  // 绝不点击、不改样式、不挪动原生节点。哈希类名随构建变化, 故多策略探测 + 缓存 5s。
  function parseNativeEntries(container) {
    const out = [];
    let nodes = [];
    try { nodes = [...container.querySelectorAll('a, button, [role="button"], li')]; } catch { nodes = []; }
    nodes.slice(0, 200).forEach(el => {
      if (out.length >= 60) return;
      let t = '';
      try { t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(); } catch {}
      if (!t || t.length > 60) return;
      if (out.length && out[out.length - 1].label === t) return; // 去连续重复
      let ref = '';
      try {
        ref = el.getAttribute?.('href')
          || el.getAttribute?.('data-message-id')
          || el.closest?.('[data-message-id]')?.getAttribute('data-message-id')
          || '';
      } catch {}
      out.push({ label: t, ref: String(ref || '').slice(0, 120) });
    });
    // 兜底: 当前构建(NATIVE-NAV-HIDE-001 反馈)目录条目是纯 div(如 ._81e7b5e > ._72b6158),
    // 无 a/button/li 可选。此时改收“叶子元素短文本”(无子元素的节点), 规则与上面一致:
    // 去空、≤60 字、去连续重复。仅当结构化选择器不足 2 条时启用, 不影响原有解析结果。
    if (out.length < 2) {
      let leaves = [];
      try { leaves = [...container.querySelectorAll('*')].filter(el => el.children.length === 0); } catch { leaves = []; }
      leaves.slice(0, 400).forEach(el => {
        if (out.length >= 60) return;
        let t = '';
        try { t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(); } catch {}
        if (!t || t.length > 60) return;
        if (out.length && out[out.length - 1].label === t) return; // 去连续重复
        out.push({ label: t, ref: '' });
      });
    }
    return out;
  }
  function probeNativeOutline(force = false) {
    const now = Date.now();
    if (!force && nativeOutlineCache.data && now - nativeOutlineCache.at < 5000) return nativeOutlineCache.data;
    let data = { found: false, strategy: null, count: 0, labels: [], labelsHash: '', containerSig: '', sample: '' };
    try {
      const candidates = [];
      // 策略1: 用户报告的当前构建类名(随时可能失效, 仅作提示之一)
      document.querySelectorAll('._6ffc3c9').forEach(el => candidates.push({ el, strategy: 'reported-hashed' }));
      // 策略2: 侧栏导航语义
      document.querySelectorAll('aside nav, aside [role="navigation"]').forEach(el => candidates.push({ el, strategy: 'aside-nav' }));
      // 策略3: 无障碍标签(目录/大纲/toc/outline)
      document.querySelectorAll('[aria-label*="目录"], [aria-label*="大纲"], [aria-label*="toc" i], [aria-label*="outline" i]').forEach(el => candidates.push({ el, strategy: 'aria' }));
      // 策略4: 当前站点右侧目录的结构钩子(如 div._189b4a0)。
      // 哈希 class 会变化, 但该容器目前带 --scroll-nav-page-padding 且包含 ds-virtual-list。
      // 仍需右侧窄栏几何约束, 避免同一 CSS 变量出现在主内容区时误标。
      document.querySelectorAll('[style*="--scroll-nav-page-padding"]').forEach(el => {
        try {
          if (!el.querySelector('.ds-virtual-list')) return;
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.width > 420 || r.left < window.innerWidth * 0.4) return;
        } catch {}
        candidates.push({ el, strategy: 'scroll-nav-style' });
      });
      // 策略5: 右侧疑似哈希类名单例容器(类名单 token 形如 _6ffc3c9, 取条目数≥2者)。
      // NATIVE-NAV-HIDE-001 加固: 加几何约束(右侧 40% 视口内且宽 ≤420px),
      // 避免把主聊区/左栏里的同形哈希容器误当目录(隐藏开关会真的收起它)。
      // 注意: 策略5 是兜底, 必须“策略1-4 全部验证失败”后才启用——
      // 真实站点上 ._6ffc3c9 常是空壳(0 条目), 若仅因它存在就跳过兜底, 探测将永远失败。
      const collectHashed = () => {
        const list = [];
        const divs = document.querySelectorAll('div[class]');
        let checked = 0;
        for (const el of divs) {
          const cls = typeof el.className === 'string' ? el.className : '';
          if (!cls || cls.includes(' ') || !/^_[0-9a-z]{5,12}$/i.test(cls)) continue;
          if (el.id === 'docdeep-outline' || el.classList.contains(INJECTED)) continue;
          if (++checked > 240) break;
          try {
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.width > 420 || r.left < window.innerWidth * 0.4) continue;
          } catch {}
          list.push({ el, strategy: 'hashed-container' });
        }
        return list;
      };
      const scan = (list) => {
        const seen = new Set();
        for (const { el, strategy } of list) {
          if (!el || !el.isConnected || seen.has(el)) continue;
          seen.add(el);
          const entries = parseNativeEntries(el);
          if (entries.length < 2) continue;
          const labels = entries.map(e => e.label);
          return {
            found: true,
            strategy,
            el, // 仅内存引用: 供原生目录隐藏打标用, 不持久化
            count: entries.length,
            labels,
            refs: entries.map(e => e.ref),
            labelsHash: hashText(labels.join('\n')),
            containerSig: `${el.tagName}.${(typeof el.className === 'string' ? el.className : '').slice(0, 80)}`,
            sample: (() => {
              try { return (el.outerHTML || '').replace(/\s+/g, ' ').trim().slice(0, 300); }
              catch { return ''; }
            })(),
          };
        }
        return null; // 按策略优先级取首个有效候选
      };
      data = scan(candidates) || scan(collectHashed())
        || { found: false, strategy: null, count: 0, labels: [], labelsHash: '', containerSig: '', sample: '' };
    } catch {}
    nativeOutlineCache = { at: now, data };
    return data;
  }
  // ---- 原生目录隐藏(NATIVE-NAV-HIDE-001): 开关开启时收起官网自带右侧目录 ----
  // 复用上方只读探测定位; 隐藏 = 打 data-docnavhide 标记 + CSS 收起(display:none),
  // 不点击、不挪动、不删节点; 关开关或关扩展即摘标记, 原站完整恢复。
  // 虚拟列表/换会话可能重挂容器, 故 classify 每轮重打标(探测自带 5s 缓存, 开销可控)。
  function nativeNavRoot(el) {
    // 沿“文本签名与目录完全相同”的祖先向上扩大, 把纯包裹层(如外层留白容器)一并收起;
    // 签名不同或祖先包住扩展大纲/正文即停, 不会误伤其它区域。
    let top = el;
    try {
      const sig = t => String(t || '').replace(/\s+/g, '');
      const self = sig(el.textContent);
      let p = el.parentElement;
      while (p && p !== document.body && !p.classList.contains(INJECTED)) {
        if (p.querySelector('#docdeep-outline')) break;
        if (sig(p.textContent) !== self) break;
        top = p;
        p = p.parentElement;
      }
    } catch {}
    return top;
  }
  function applyNativeNavHide(forceProbe = false) {
    if (!isOn()) return;
    let want = false;
    try { want = settings.docdeep_hide_native === true; } catch {}
    if (!want) {
      document.querySelectorAll('[data-docnavhide]').forEach(n => n.removeAttribute('data-docnavhide'));
      return;
    }
    const d = probeNativeOutline(forceProbe);
    if (d && d.found && d.el && d.el.isConnected && d.count >= 2) {
      const root = nativeNavRoot(d.el);
      try { root.setAttribute('data-docnavhide', '1'); } catch {}
    }
    // 清掉已脱离探测结果的残留标记(容器随构建/会话重挂, 旧标记节点可能仍在文档里)
    document.querySelectorAll('[data-docnavhide]').forEach(n => {
      try { if (!n.isConnected || (d && d.found && n !== nativeNavRoot(d.el))) n.removeAttribute('data-docnavhide'); } catch {}
    });
  }

  // 把原生目录条目与本地 qOrder 按文本包含关系贪心对齐(各用一次, 保序)。
  // 返回 { total, matched, consistent, missing }: consistent 且 missing>0 意味着“还有未加载的历史”。
  function alignNativeWithRegistry(nativeLabels) {
    const norm = s => String(s || '').replace(/\s+/g, '').trim();
    const natives = (nativeLabels || []).map(norm).filter(Boolean);
    if (!natives.length || !qOrder.length) {
      return { total: natives.length, matched: 0, consistent: true, missing: natives.length };
    }
    const fulls = qOrder.map(k => norm(qInfo.get(k)?.text || ''));
    const used = new Set();
    const seq = []; // 与 qOrder 同序的原生下标序列
    fulls.forEach(full => {
      if (!full) { seq.push(-1); return; }
      const probe = full.slice(0, 12);
      let hit = -1;
      for (let i = 0; i < natives.length; i++) {
        if (used.has(i)) continue;
        const n = natives[i];
        const short = (a, b) => a && b && (a.includes(b) || b.includes(a));
        if (short(n, probe) || (n.slice(0, 12) && short(n.slice(0, 12), probe))) { hit = i; break; }
      }
      if (hit >= 0) { used.add(hit); seq.push(hit); }
      else seq.push(-1);
    });
    const matched = seq.filter(i => i >= 0).length;
    let consistent = true;
    let prev = -1;
    seq.forEach(i => {
      if (i < 0) return;
      if (i < prev) consistent = false;
      prev = Math.max(prev, i);
    });
    return { total: natives.length, matched, consistent, missing: Math.max(0, natives.length - matched) };
  }
