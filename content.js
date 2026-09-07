/* DeepSeek 文档化阅读 v0.3 — content.js
 * 原则: 只打标 + 注入可摘除 UI, 不挪动 textarea/form/发送按钮,
 * 不读 token/cookie, 不调私有 API, 不改 fetch。
 * 所有注入节点带 .docdeep-injected, 关闭时完整摘除即恢复原站。
 */
(() => {
  'use strict';
  const ATTR = 'data-docdeep';
  const THEME_ATTR = 'data-doctheme';
  const INJECTED = 'docdeep-injected';
  const TURN_SEL = '.ds-message, [data-message-id]';
  const AI_SEL = '.ds-markdown.ds-assistant-message-main-content, .ds-assistant-message-main-content';
  const THINK_SEL = '.ds-thinking, [class*="ds-thinking"], [data-thinking]';
  const USER_COLLAPSE_LEN = 420;
  const VERSION = '0.3.15';
  const DEFAULTS = { docdeep_enabled: true, docdeep_width: 880, docdeep_font: 17, docdeep_theme: 'mi', docdeep_outline: true, docdeep_keys: true, docdeep_hide_native: false };

  let lastUrl = location.href;
  let scheduled = false;
  let outlineScheduled = false;
  let spyScheduled = false;
  let olReg = []; // 大纲 scrollspy 注册表: 仅引用注入按钮与目标, 不碰原文
  let lastTurnOrder = [];
  let outlineDirty = true;
  // ---- 虚拟列表稳定层: 跨滚动累积“完整会话”认知, 不只信当前挂载 DOM ----
  // qOrder: 用户提问 key 自上而下(逻辑顺序)的最佳已知全集; qInfo: key -> { text }
  // liveElByKey: 当前已挂载 key -> element(每轮 classify 重建, 仅用于定位/高亮)
  let qOrder = [];
  let qInfo = new Map();
  let liveElByKey = new Map();
  let outlineSearchToken = 0;
  // ---- 原生目录只读缓存: DeepSeek 右侧自带对话目录(如当前构建的 div._6ffc3c9) ----
  // 哈希类名随构建变化, 故只作多策略探测之一, 结论仅用于核对计数/顺序, 不作为唯一真相。
  let nativeOutlineCache = { at: 0, data: null };
  let settings = { ...DEFAULTS };
  let findState = { open: false, keyword: '', results: [], index: -1 };
  let exportState = null;
  let outlineComplete = null; // Phase-2 一键补全独立令牌(禁止复用 exportState 对象)
  // Phase-3 选择性导出: null=未触碰=全量, Set=已触碰选中集(内存态,不落盘,URL切换清空)
  let selectedQKeys = null;
  let onlySelectedView = false;

  const isOn = () => document.documentElement.getAttribute(ATTR) === 'on';

  function applySettings(s) {
    const previousHideNative = settings.docdeep_hide_native === true;
    settings = { ...DEFAULTS, ...s };
    const hideNativeChanged = previousHideNative !== (settings.docdeep_hide_native === true);
    if (hideNativeChanged) {
      // 隐藏开关切换时不要复用“目录尚未挂载”的负缓存, 立即重探测。
      nativeOutlineCache = { at: 0, data: null };
    }
    // PAPER-WIDTH-001(见 docs/known-issues.md): 纸宽功能挂起，冻结为默认值，忽略存量
    settings.docdeep_width = 880;
    if (!isOn()) { heartbeat(true); return; }
    const root = document.documentElement;
    root.style.setProperty('--doc-paper-w', '880px');
    root.style.setProperty('--doc-font', settings.docdeep_font + 'px');
    root.setAttribute(THEME_ATTR, settings.docdeep_theme);
    root.dataset.docdeepVer = VERSION;
    applyNativeNavHide(hideNativeChanged);
    heartbeat(true);
  }

  function setOn(on) {
    const root = document.documentElement;
    if (on) {
      root.setAttribute(ATTR, 'on');
      root.style.setProperty('--doc-paper-w', '880px');
      root.style.setProperty('--doc-font', settings.docdeep_font + 'px');
      root.setAttribute(THEME_ATTR, settings.docdeep_theme);
      root.dataset.docdeepVer = VERSION;
    } else {
      root.removeAttribute(ATTR);
      root.removeAttribute(THEME_ATTR);
      delete root.dataset.docdeepVer;
      root.style.removeProperty('--doc-paper-w');
      root.style.removeProperty('--doc-font');
      document.querySelectorAll('.' + INJECTED).forEach(n => n.remove());
      document.querySelectorAll('[data-docturn]').forEach(n => n.removeAttribute('data-docturn'));
      document.querySelectorAll('[data-doc-think-done]').forEach(n => n.removeAttribute('data-doc-think-done'));
      document.querySelectorAll('[data-docrole], [data-docfp]').forEach(n => {
        n.removeAttribute('data-docrole');
        n.removeAttribute('data-docfp');
      });
      document.querySelectorAll('[data-docshell]').forEach(n => n.removeAttribute('data-docshell'));
      document.querySelectorAll('[data-docnavhide]').forEach(n => n.removeAttribute('data-docnavhide'));
      nativeOutlineCache = { at: 0, data: null };
      shellCache = { at: 0, header: null, side: null };
      document.querySelectorAll('.doc-user-collapsed, .doc-think-collapsed').forEach(n => {
        n.classList.remove('doc-user-collapsed', 'doc-think-collapsed');
      });
      document.querySelectorAll('[data-doc-search-hit]').forEach(n => {
        n.removeAttribute('data-doc-search-hit');
        n.classList.remove('doc-search-hit', 'doc-search-active');
      });
      document.querySelectorAll('textarea[data-doc-ph]').forEach(ta => {
        ta.placeholder = ta.dataset.docOriginalPlaceholder || '';
        delete ta.dataset.docOriginalPlaceholder;
        delete ta.dataset.docPh;
      });
      findState = { open: false, keyword: '', results: [], index: -1 };
      olReg = [];
      lastTurnOrder = [];
      outlineDirty = true;
      qOrder = [];
      qInfo = new Map();
      liveElByKey = new Map();
      // Phase-3: 选中态与 qOrder 同命,关闭即清空,重开为全量
      selectedQKeys = null;
      onlySelectedView = false;
      outlineSearchToken++;
      exportState?.cancel?.();
      exportState = null;
      // Phase-2: 补全令牌取消 + 帮助外部点击监听摘除(帮助节点随 .docdeep-injected 自动摘除)
      if (outlineComplete) outlineComplete.cancelled = true;
      outlineComplete = null;
      document.removeEventListener('mousedown', keysHelpOutside, true);
    }
  }

  function toast(text) {
    document.querySelectorAll('#docdeep-toast').forEach(n => n.remove());
    const t = document.createElement('div');
    t.id = 'docdeep-toast';
    t.className = INJECTED;
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  // ---- 自证: 快照 / 心跳 / ping(供 popup 一键诊断, 用户无需手动采集) ----
  let lastHb = 0;
  function snapshot() {
    const cs = getComputedStyle(document.documentElement);
    return {
      ver: VERSION,
      on: isOn(),
      url: location.href,
      attr: document.documentElement.getAttribute(ATTR),
      theme: document.documentElement.getAttribute(THEME_ATTR),
      expect: { w: '880px(冻结)', f: settings.docdeep_font + 'px', theme: settings.docdeep_theme },
      computed: {
        w: cs.getPropertyValue('--doc-paper-w').trim(),
        f: cs.getPropertyValue('--doc-font').trim(),
      },
      turns: document.querySelectorAll('[data-docturn]').length,
      questions: qOrder.length,
      outline: !!document.querySelector('#docdeep-outline'),
      tools: !!document.querySelector('#docdeep-tools'),
      nativeOutline: (() => { try { return nativeOutlineSnapshot(); } catch { return { found: false }; } })(),
      widthProbe: (() => {
        try {
          const turns = [...document.querySelectorAll('[data-docturn]')];
          const el = turns.find(e => e.clientWidth > 0) || turns[0];
          if (!el) return null;
          const csEl = getComputedStyle(el);
          const inner = el.firstElementChild;
          return {
            cardMax: csEl.maxWidth,
            cardW: el.clientWidth,
            parentW: el.parentElement ? el.parentElement.clientWidth : null,
            innerMax: inner ? getComputedStyle(inner).maxWidth : null,
          };
        } catch { return null; }
      })(),
      time: Date.now(),
      chain: (() => {
        try {
          const turns = [...document.querySelectorAll('[data-docturn]')];
          const el = turns.find(e => e.clientWidth > 0) || turns[0];
          if (!el) return null;
          const layers = [];
          let n = el.parentElement, d = 0;
          while (n && n !== document.body && d < 8) {
            const c = getComputedStyle(n);
            layers.push({
              t: n.tagName,
              c: (typeof n.className === 'string' ? n.className : '').slice(0, 60),
              w: n.clientWidth, max: c.maxWidth,
            });
            n = n.parentElement; d++;
          }
          return {
            vp: document.documentElement.clientWidth,
            side: (shellCache.side && shellCache.side.isConnected ? shellCache.side.clientWidth : (document.querySelector('aside')?.clientWidth || 0)),
            layers,
          };
        } catch { return null; }
      })(),
    };
  }
  function heartbeat(force) {
    const now = Date.now();
    if (!force && now - lastHb < 4000) return;
    lastHb = now;
    try { chrome.storage.local.set({ docdeep_heartbeat: snapshot() }); } catch {}
  }

  function turnText(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.' + INJECTED).forEach(n => n.remove());
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // Q-INFLATE-001(见 docs/known-issues.md): 新提问后 AI 思考流阶段的 assistant 气泡
  // 只有 THINK_SEL 内容、尚无 AI_SEL, 旧 isUserTurn 会误判为 user, 每 tick 一个哈希 key
  // 导致 Q5 后冒出 Q6…Q36“正在思考…”(哈希 key 随流式文本变长而每次新建、只增不减)。
  function isAssistantStructure(el) {
    try {
      if (el.matches?.(AI_SEL)) return true;
      if (el.querySelector?.(AI_SEL)) return true;
      if (el.matches?.(THINK_SEL)) return true;
      if (el.querySelector?.(THINK_SEL)) return true;
    } catch {}
    return false;
  }
  // 严格“赝 Q”文本判定(仅用于清理历史污染, 不用于分类):
  // 要求“正在思考”双写/重复, 单次“正在思考是什么意思?”类真实提问不受影响。
  function isBogusQuestionText(text) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    const nospace = raw.replace(/\s+/g, '');
    if (/^(正在思考){2,}/.test(nospace)) return true;
    if (/正在思考.{0,6}正在思考/.test(nospace)) return true;
    if (/^思考过程\(已折叠/.test(raw)) return true;
    if (/^(Thinking){2,}/i.test(nospace)) return true;
    return false;
  }
  function pruneBogusQuestions() {
    if (!qOrder.length) return false;
    let removed = false;
    const keep = [];
    qOrder.forEach(k => {
      const t = qInfo.get(k)?.text || '';
      if (typeof k === 'string' && k.startsWith('u:') && isBogusQuestionText(t)) {
        qInfo.delete(k);
        liveElByKey.delete(k);
        try { selectedQKeys?.delete?.(k); } catch {}
        removed = true;
      } else {
        keep.push(k);
      }
    });
    if (removed) {
      qOrder = keep;
      outlineDirty = true;
    }
    return removed;
  }

  function isUserTurn(el, text = turnText(el)) {
    if (isAssistantStructure(el)) return false;
    return text.length > 0;
  }

  function resetTurn(el) {
    el.querySelectorAll('.' + INJECTED).forEach(n => n.remove());
    el.classList.remove('doc-user-collapsed', 'doc-think-collapsed');
    el.removeAttribute('data-doc-think-done');
  }

  function tagUser(el) {
    if (el.querySelector(':scope > .doc-qtag, :scope .doc-qtag')) return;
    const tag = document.createElement('span');
    tag.className = 'doc-qtag ' + INJECTED;
    tag.textContent = '我的提问';
    (el.firstElementChild || el).prepend(tag);
    // 超长折叠
    const len = (el.innerText || '').length;
    if (len > USER_COLLAPSE_LEN && !el.classList.contains('doc-user-collapsed')) {
      el.classList.add('doc-user-collapsed');
      const btn = document.createElement('button');
      btn.className = 'doc-expand ' + INJECTED;
      btn.textContent = '展开全文';
      btn.addEventListener('click', () => {
        const c = el.classList.toggle('doc-user-collapsed');
        btn.textContent = c ? '展开全文' : '收起';
        scheduleOutline();
      });
      el.appendChild(btn);
    }
  }

  function tagThink(el) {
    const think = el.querySelector(THINK_SEL);
    if (!think || think.hasAttribute('data-doc-think-done')) return;
    think.setAttribute('data-doc-think-done', '1');
    think.classList.add('ds-thinking-inner');
    const btn = document.createElement('button');
    btn.className = 'doc-thinkbtn ' + INJECTED;
    btn.textContent = '思考过程(已折叠,点击展开)';
    btn.addEventListener('click', () => {
      const c = el.classList.toggle('doc-think-collapsed');
      btn.textContent = c ? '思考过程(已折叠,点击展开)' : '思考过程(已展开,点击收起)';
    });
    el.classList.add('doc-think-collapsed');
    think.before(btn);
  }

  // ---- 稳定提问注册表(修复虚拟列表只挂载子集导致的 Q3-Q1-Q2) ----
  // key 优先 data-message-id, 否则 u:/a: + 文本哈希; 用户问文本稳定, 可跨复用/滚动保持同一 key。
  function keyForTurnEl(el, role, text) {
    const messageId = el.getAttribute?.('data-message-id')
      || el.querySelector?.('[data-message-id]')?.getAttribute('data-message-id');
    if (messageId) return (role === 'user' ? 'u:' : 'a:') + messageId;
    return (role === 'user' ? 'u:' : 'a:') + hashText(text || '');
  }
  function questionSnippet(text) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    return s.length > 22 ? s.slice(0, 22) + '…' : s;
  }
  function qNumberOf(key) {
    const i = qOrder.indexOf(key);
    return i < 0 ? 0 : i + 1;
  }
  // 把当前挂载的用户问(已按 DOM 自上而下)合并进全局 qOrder。
  // 场景: 初进只看到最新 2 问(Q?/Q?)→滚到顶部才挂载更早的提问, 必须前插而非追加,
  // 且已编号不得因视口变化而抖动。DOM 顺序只作为“已挂载子集的相对顺序”真相。
  function mergeQuestionOrder(currentKeys) {
    if (!currentKeys.length) return false;
    const known = new Set(qOrder);
    const fresh = currentKeys.filter(k => !known.has(k));
    if (!qOrder.length) {
      qOrder = [...currentKeys];
      return true;
    }
    if (!fresh.length) {
      // 无新 key 也要对账相对顺序: 虚拟列表复用/流式可能导致引用顺序抖动,
      // 以当前 DOM 子集顺序为准重排 qOrder 中的对应片段。
      const pos = new Map(currentKeys.map((k, i) => [k, i]));
      const filtered = qOrder.filter(k => pos.has(k));
      let ordered = true;
      for (let i = 1; i < filtered.length; i++) {
        if (pos.get(filtered[i - 1]) > pos.get(filtered[i])) { ordered = false; break; }
      }
      if (ordered) return false;
      const rank = new Map(currentKeys.map((k, i) => [k, i]));
      const block = new Set(currentKeys);
      const rest = qOrder.filter(k => !block.has(k));
      const sortedBlock = [...block].filter(k => qOrder.includes(k) || true).sort((a, b) => rank.get(a) - rank.get(b));
      // 把重排后的块放回首个锚点处, 其余保持不动
      let anchor = rest.length ? -1 : -1;
      // 找到块在原 qOrder 中的首个位置, 就地替换为排好序的块
      const firstIdx = qOrder.findIndex(k => block.has(k));
      qOrder = [...qOrder.slice(0, firstIdx), ...sortedBlock, ...qOrder.slice(firstIdx).filter(k => !block.has(k))];
      void anchor; void rest;
      return true;
    }
    const firstCommon = currentKeys.find(k => known.has(k));
    const lastCommon = [...currentKeys].reverse().find(k => known.has(k));
    if (firstCommon === undefined || lastCommon === undefined) {
      // 与已知完全无交集(大跳跃): 按滚动位置启发式决定前插还是后追加
      try {
        const c = scrollContainer();
        const maxTop = Math.max(0, (Number(c.scrollHeight) || 0) - (Number(c.clientHeight) || 0));
        const top = Number(c.scrollTop) || 0;
        if (maxTop > 0 && top < maxTop * 0.3) qOrder = [...currentKeys, ...qOrder.filter(k => !new Set(currentKeys).has(k))];
        else qOrder = [...qOrder, ...fresh];
      } catch { qOrder = [...qOrder, ...fresh]; }
      return true;
    }
    const firstKnownIdx = qOrder.indexOf(firstCommon);
    const lastKnownIdx = qOrder.indexOf(lastCommon);
    const lo = Math.min(firstKnownIdx, lastKnownIdx);
    const hi = Math.max(firstKnownIdx, lastKnownIdx);
    // 当前视图在锚点之间的缺失 key, 按 DOM 相对位置逐个插入
    const next = [...qOrder];
    const placed = new Set(next);
    const iFirst = currentKeys.indexOf(firstCommon);
    const iLast = currentKeys.indexOf(lastCommon);
    const [s, e] = iFirst <= iLast ? [iFirst, iLast] : [iLast, iFirst];
    // 若锚点本身顺序倒置, 先以 DOM 顺序校正锚点段
    const segmentKnown = next.slice(lo, hi + 1);
    const orderInCurrent = new Map(currentKeys.map((k, i) => [k, i]));
    const segmentHasAll = segmentKnown.every(k => orderInCurrent.has(k));
    void segmentHasAll;
    for (let i = s; i <= e; i++) {
      const key = currentKeys[i];
      if (placed.has(key)) continue;
      // 插到其在当前视图中的前驱之后(前驱已放置), 否则插到后继之前
      let anchorIdx = -1;
      for (let j = i - 1; j >= s; j--) {
        const p = next.indexOf(currentKeys[j]);
        if (p >= 0) { anchorIdx = p; break; }
      }
      if (anchorIdx >= 0) next.splice(anchorIdx + 1, 0, key);
      else {
        let afterIdx = -1;
        for (let j = i + 1; j <= e; j++) {
          const p = next.indexOf(currentKeys[j]);
          if (p >= 0) { afterIdx = p; break; }
        }
        if (afterIdx >= 0) next.splice(afterIdx, 0, key);
        else next.splice(lo, 0, key);
      }
      placed.add(key);
    }
    // 视图在首锚点之前的新 key → 整体前插到首锚点前(保持 DOM 相对顺序)
    const headFresh = (iFirst <= iLast ? currentKeys.slice(0, iFirst) : currentKeys.slice(0, iLast))
      .filter(k => !qOrder.includes(k));
    // 视图在尾锚点之后的新 key → 整体后插到尾锚点后
    const tailFresh = (iFirst <= iLast ? currentKeys.slice(iLast + 1) : currentKeys.slice(iFirst + 1))
      .filter(k => !qOrder.includes(k));
    let merged = [...next];
    if (headFresh.length) {
      const at = merged.indexOf(iFirst <= iLast ? firstCommon : lastCommon);
      merged = [...merged.slice(0, at), ...headFresh, ...merged.slice(at)];
    }
    // 尾部插入位置需重算(前插后下标已变)
    if (tailFresh.length) {
      const anchor = iFirst <= iLast ? lastCommon : firstCommon;
      const at = merged.indexOf(anchor);
      merged = [...merged.slice(0, at + 1), ...tailFresh, ...merged.slice(at + 1)];
    }
    // 去重保序
    const seen = new Set();
    qOrder = merged.filter(k => (seen.has(k) ? false : (seen.add(k), true)));
    return true;
  }
  // 每轮 classify 后调用: 更新文本(取最长)、合并顺序、重建 liveElByKey。
  // 返回 { orderChanged, infoChanged } 供调用方决定是否重编号/重绘大纲。
  function updateQuestionRegistry(turns) {
    let infoChanged = false;
    const currentKeys = [];
    const nextLive = new Map();
    turns.forEach(el => {
      const role = el.getAttribute('data-docrole') || (el.querySelector('.doc-qtag') ? 'user' : null);
      if (role !== 'user') return;
      // 纵深防御: 同批内 role 仍是旧值(如思考流刚翻转)时, 以实时结构再拦一次
      if (isAssistantStructure(el)) return;
      const text = stripQuestionLabel(cleanTurnText(el));
      if (!text) return;
      if (isBogusQuestionText(text)) return;
      const key = keyForTurnEl(el, 'user', text);
      currentKeys.push(key);
      nextLive.set(key, el);
      const prev = qInfo.get(key);
      if (!prev || text.length > prev.text.length) {
        qInfo.set(key, { text });
        if (!prev || prev.text !== text) infoChanged = true;
      }
    });
    liveElByKey = nextLive;
    const before = qOrder.join('\n');
    const orderChanged = mergeQuestionOrder(currentKeys);
    if (qOrder.join('\n') !== before) return { orderChanged: true, infoChanged };
    return { orderChanged, infoChanged };
  }
  function renumberQuestions(turns) {
    // 全局稳定编号: 按 qOrder(全集顺序)而非当前挂载子集下标, 滚动不再抖动。
    turns.forEach(el => {
      if (el.getAttribute('data-docrole') !== 'user') return;
      const tag = el.querySelector('.doc-qtag');
      if (!tag) return;
      const text = stripQuestionLabel(cleanTurnText(el));
      const key = keyForTurnEl(el, 'user', text || tag.textContent);
      let n = qNumberOf(key);
      if (!n) {
        // 兜底: 尚未入库(如文本为空的瞬间), 按挂载顺序临时编号, 下轮对账修正
        n = qOrder.length + 1;
      }
      const want = 'Q' + n + ' · 我的提问';
      if (tag.textContent !== want) tag.textContent = want;
    });
  }

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
    const subRow = document.createElement('div');
    subRow.className = 'doc-tools-row doc-tools-row--sub ' + INJECTED;
    const tools = document.createElement('button');
    tools.type = 'button';
    tools.textContent = '回到顶部';
    tools.title = '回到会话开头';
    tools.addEventListener('click', scrollTop);
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = '复制全文';
    copy.title = '复制当前会话全文为 Markdown';
    copy.addEventListener('click', () => copyFull().then(ok => toast(ok ? '全文已复制,可粘贴到笔记' : '复制失败,请手动选择复制')));
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
    const print = document.createElement('button');
    print.type = 'button';
    print.textContent = '打印';
    print.title = '打印或另存为 PDF';
    print.addEventListener('click', () => window.print());
    const exportMd = document.createElement('button');
    exportMd.type = 'button';
    exportMd.textContent = '导出 Markdown';
    exportMd.title = '导出为 Markdown 文件';
    exportMd.addEventListener('click', () => exportConversation('md'));
    const exportHtml = document.createElement('button');
    exportHtml.type = 'button';
    exportHtml.textContent = '导出 HTML';
    exportHtml.title = '导出自包含 HTML 单文件';
    exportHtml.addEventListener('click', () => exportConversation('html'));
    mainRow.append(tools, copy, find, outline, print);
    subRow.append(exportMd, exportHtml);
    bar.append(mainRow, subRow);

    const meta = document.createElement('div');
    meta.className = 'doc-tools-meta ' + INJECTED;
    const ver = document.createElement('span');
    ver.id = 'docdeep-ver';
    ver.className = INJECTED;
    ver.textContent = '文档化 v' + VERSION;
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
      refreshFindResults();
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
    document.querySelectorAll('[data-doc-search-hit]').forEach(el => {
      el.removeAttribute('data-doc-search-hit');
      el.classList.remove('doc-search-hit', 'doc-search-active');
    });
    document.querySelector('#docdeep-find')?.style.setProperty('display', 'none');
    findState = { open: false, keyword: '', results: [], index: -1 };
  }

  function refreshFindResults() {
    if (!findState.open) return;
    const panel = document.querySelector('#docdeep-find');
    if (!panel) return;
    const input = panel.querySelector('input');
    const count = panel.querySelector('.doc-find-count');
    const keyword = (input?.value || findState.keyword || '').trim().toLocaleLowerCase();
    findState.keyword = keyword;
    document.querySelectorAll('[data-doc-search-hit]').forEach(el => {
      el.removeAttribute('data-doc-search-hit');
      el.classList.remove('doc-search-hit', 'doc-search-active');
    });
    if (!keyword) {
      findState.results = [];
      findState.index = -1;
      if (count) { count.textContent = '0/0'; count.classList.add('is-empty'); }
      return;
    }
    findState.results = [...document.querySelectorAll('[data-docturn]')].filter(el => {
      return cleanTurnText(el).toLocaleLowerCase().includes(keyword);
    });
    if (findState.results.length && (findState.index < 0 || findState.index >= findState.results.length)) {
      findState.index = 0;
    }
    findState.results.forEach((el, index) => {
      el.setAttribute('data-doc-search-hit', '1');
      el.classList.add('doc-search-hit');
      el.classList.toggle('doc-search-active', index === findState.index);
    });
    if (count) {
      count.textContent = findState.results.length
        ? `${findState.index + 1}/${findState.results.length}`
        : '0/0';
      count.classList.toggle('is-empty', !findState.results.length);
      count.title = findState.results.length ? `共 ${findState.results.length} 处匹配` : '暂无匹配';
    }
  }

  function moveFind(step) {
    if (!findState.open) openFind();
    if (!findState.results.length) return;
    findState.index = (findState.index + step + findState.results.length) % findState.results.length;
    const el = findState.results[findState.index];
    el.classList.add('doc-search-active');
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    refreshFindResults();
  }

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

  function ensureExportProgress() {
    let panel = document.querySelector('#docdeep-export-progress');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'docdeep-export-progress';
    panel.className = INJECTED;
    const text = document.createElement('span');
    text.className = 'doc-export-text';
    text.textContent = '准备导出…';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => exportState?.cancel?.());
    panel.append(text, cancel);
    document.body.appendChild(panel);
    return panel;
  }

  function setExportProgress(text) {
    const panel = ensureExportProgress();
    const label = panel.querySelector('.doc-export-text');
    if (label) label.textContent = text;
  }

  function hideExportProgress() {
    document.querySelector('#docdeep-export-progress')?.remove();
  }

  function cleanTurnText(el) {
    const clone = el.cloneNode(true);
    // Phase-3: pre 先转 ```lang 围栏(代码语言保留),再删注入节点取文本;查找/复制/采集复用同一口径
    try {
      clone.querySelectorAll('pre').forEach(pre => {
        const code = pre.querySelector('code');
        const src = code || pre;
        const lang = parseCodeLang(((code?.className || '') + ' ' + (pre.className || '')));
        const body = ((code?.innerText ?? src.innerText ?? src.textContent) || '').replace(/\s+$/, '');
        const fenced = body ? fenceCode(lang, body) : '';
        if (fenced) pre.replaceWith(document.createTextNode('\n' + fenced + '\n'));
      });
    } catch {}
    clone.querySelectorAll('.doc-qtag,.doc-expand,.doc-thinkbtn,#docdeep-outline,#docdeep-tools,#docdeep-find,#docdeep-export-progress').forEach(n => n.remove());
    return (clone.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  function hashText(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  // ---- Phase-3 选择性导出纯函数(不碰 DOM,Node 可测) ----
  function parseCodeLang(className) {
    const m = String(className || '').toLowerCase().match(/language-([a-z0-9+#-]+)/);
    return m ? m[1] : '';
  }
  function fenceCode(lang, code) {
    const body = String(code ?? '').replace(/\s+$/, '');
    if (!body) return '';
    return '```' + String(lang || '') + '\n' + body + '\n```';
  }
  function buildFrontMatter({ title, url, exportedAt, schemaVersion, selection }) {
    const esc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `---\ntitle: "${esc(title)}"\nurl: "${esc(url)}"\nexportedAt: "${esc(exportedAt)}"\nschemaVersion: ${Number(schemaVersion) || 1}\nselection: "${esc(selection || 'all')}"\n---`;
  }
  // 按 user 问切分归属:选中 Q 及其后随 AI 答保留;首个 Q 前悬空 AI 跳过;空/null 即全量
  function filterRecordsByQ(records, selectedKeys) {
    const list = Array.isArray(records) ? records : [];
    if (!selectedKeys || selectedKeys.size === 0) return [...list];
    const out = [];
    let cur = null; // 当前归属 Q key(仅 user 问更新)
    list.forEach(r => {
      if (!r) return;
      if (r.role === 'user') {
        cur = r.key || null;
        if (cur && selectedKeys.has(cur)) out.push(r);
      } else if (cur && selectedKeys.has(cur)) {
        out.push(r);
      }
    });
    return out;
  }

  // ---- Phase-4 自包含 HTML(内联样式,离线可读;图片延后:仅转义文本,不内嵌远端) ----
  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function mdToHtmlBody(records) {
    const out = [];
    (Array.isArray(records) ? records : []).forEach(r => {
      if (!r || !r.text) return;
      if (r.role === 'user') {
        out.push('<h2>' + escapeHtml(stripQuestionLabel(r.text)) + '</h2>');
        return;
      }
      const blocks = String(r.text).split(/\n{2,}/);
      blocks.forEach(b => {
        const t = b.trim();
        if (!t) return;
        if (/^---+$/.test(t)) { out.push('<hr>'); return; }
        const fence = t.match(/^```([a-z0-9+#-]*)\n([\s\S]*?)\n```$/i);
        if (fence) {
          out.push('<pre><code' + (fence[1] ? ' data-lang="' + escapeHtml(fence[1]) + '"' : '') + '>' + escapeHtml(fence[2]) + '</code></pre>');
          return;
        }
        if (/^##\s+/.test(t)) { out.push('<h2>' + escapeHtml(t.replace(/^##\s+/, '')) + '</h2>'); return; }
        out.push('<p>' + escapeHtml(t).replace(/\n/g, '<br>') + '</p>');
      });
    });
    return out.join('\n');
  }
  function buildHtml(records, title, opts = {}) {
    const url = opts.url || (typeof location !== 'undefined' ? location.href : '');
    const exportedAt = opts.exportedAt || new Date().toISOString();
    const sel = opts.selectionLabel || 'all';
    const list = Array.isArray(records) ? records.filter(r => r && r.text) : [];
    return '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>'
      + escapeHtml(title) + '</title>\n<style>\n'
      + 'body{max-width:880px;margin:0 auto;padding:32px 20px;font:16px/1.9 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#2D2A26;background:#F8F7F4}\n'
      + 'h1{font-size:24px;border-bottom:1px solid #E2DBD2;padding-bottom:8px}\nh2{font-size:19px;color:#2D2A26;margin:1.2em 0 .5em}\n'
      + 'pre{background:#F1EFE8;color:#2D2A26;border-radius:10px;padding:12px 14px;overflow:auto;font-size:13px;line-height:1.7}\n'
      + 'blockquote{border-left:4px solid #C9A227;background:#FBF6E7;margin:1em 0;padding:8px 14px;color:#6B5F3F}\n'
      + 'hr{border:0;border-top:1px dashed #E2DBD2;margin:2em 0}\n.meta{color:#797368;font-size:12px}\n'
      + '</style>\n</head>\n<body>\n<h1>' + escapeHtml(title) + '</h1>\n'
      + '<p class="meta">来源 <a href="' + escapeHtml(url) + '">' + escapeHtml(url) + '</a> · 导出 ' + escapeHtml(exportedAt) + ' · 选择 ' + escapeHtml(sel) + ' · 共 ' + list.filter(r => r.role === 'user').length + ' 问</p>\n<hr>\n'
      + mdToHtmlBody(list) + '\n</body>\n</html>\n';
  }

  function turnRecord(el) {
    const text = cleanTurnText(el);
    if (!text) return null;
    const role = el.getAttribute('data-docrole');
    const user = role ? role === 'user' : (!!el.querySelector('.doc-qtag') || isUserTurn(el));
    const messageId = el.getAttribute('data-message-id')
      || el.querySelector('[data-message-id]')?.getAttribute('data-message-id');
    const key = `${user ? 'u' : 'a'}:${messageId || hashText(text)}`;
    return { key, role: user ? 'user' : 'assistant', text };
  }

  function collectVisibleTurns(records) {
    document.querySelectorAll('[data-docturn]').forEach(el => {
      const record = turnRecord(el);
      if (!record) return;
      const previous = records.get(record.key);
      if (!previous || record.text.length > previous.text.length) records.set(record.key, record);
    });
  }

  function scrollToExact(container, top) {
    try { container.scrollTo({ top, behavior: 'auto' }); }
    catch { container.scrollTop = top; }
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function collectAllTurns() {
    const records = new Map();
    const container = scrollContainer();
    const initialTop = Number(container.scrollTop) || 0;
    const viewport = Math.max(240, Number(container.clientHeight) || window.innerHeight || 600);
    const step = Math.max(240, Math.floor(viewport * 0.8));
    const collect = () => {
      if (!isOn() || !exportState || exportState.cancelled) throw new Error('cancelled');
      classify();
      collectVisibleTurns(records);
    };

    setExportProgress('正在读取当前已显示内容…');
    try {
      const canScroll = Number(container.scrollHeight) > viewport + 20;
      if (canScroll) {
        scrollToExact(container, 0);
        await wait(140);
        collect();
      } else {
        collect();
      }

      let top = Number(container.scrollTop) || 0;
      let stableBottom = 0;
      let previousCount = -1;
      for (let i = 0; i < 320; i++) {
        if (!isOn() || !exportState || exportState.cancelled) throw new Error('cancelled');
        const maxTop = Math.max(0, (Number(container.scrollHeight) || 0) - viewport);
        if (top >= maxTop - 2) {
          stableBottom = records.size === previousCount ? stableBottom + 1 : 0;
          if (stableBottom >= 2) break;
          previousCount = records.size;
          await wait(140);
          collect();
          top = Number(container.scrollTop) || top;
          continue;
        }
        stableBottom = 0;
        top = Math.min(maxTop, top + step);
        scrollToExact(container, top);
        await wait(140);
        collect();
        previousCount = records.size;
        if (i % 2 === 0) setExportProgress(`正在采集对话…已发现 ${records.size} 个消息`);
      }
      setExportProgress(`已采集 ${records.size} 个消息，正在生成文件…`);
      return [...records.values()];
    } finally {
      scrollToExact(container, initialTop);
      await wait(40);
    }
  }

  function exportTitle() {
    return (document.title || 'DeepSeek 会话')
      .replace(/\s*-\s*DeepSeek\s*$/i, '')
      .trim() || 'DeepSeek 会话';
  }

  function exportFilename(title) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const safe = title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim();
    return `${(safe || 'deepseek-conversation').slice(0, 120)}-${date}`;
  }

  function stripQuestionLabel(text) {
    return text.replace(/^Q\d+ · 我的提问\s*/, '').trim();
  }

  function buildMarkdown(records, title, opts = {}) {
    const fm = opts.frontMatter === undefined ? true : !!opts.frontMatter;
    const url = opts.url || (typeof location !== 'undefined' ? location.href : '');
    const exportedAt = opts.exportedAt || new Date().toISOString();
    const head = fm ? buildFrontMatter({
      title,
      url,
      exportedAt,
      schemaVersion: 1,
      selection: opts.selectionLabel || 'all',
    }) + '\n\n' : '';
    let questionNumber = 0;
    const parts = records.map(record => {
      if (record.role === 'user') {
        questionNumber++;
        // 选中导出保持原 Q 号(如 Q7),全量/无 key 时回退顺序号
        let n = questionNumber;
        try {
          if (record.key && typeof opts.qNumberOf === 'function') {
            const keep = Number(opts.qNumberOf(record.key));
            if (keep > 0) n = keep;
          }
        } catch {}
        return `## Q${n} 我的提问\n\n${stripQuestionLabel(record.text)}`;
      }
      return record.text;
    }).filter(Boolean);
    return `${head}# ${title}\n\n${parts.join('\n\n---\n\n')}\n`;
  }

  function buildExport(format, records, title, opts = {}) {
    if (format === 'json') {
      return JSON.stringify({
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        title,
        url: location.href,
        turns: records.map(record => ({ role: record.role, text: record.text })),
      }, null, 2);
    }
    if (format === 'html') return buildHtml(records, title, opts);
    return buildMarkdown(records, title, opts);
  }

  function requestDownload(message) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage(message, response => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(response || null);
        });
      } catch { resolve(null); }
    });
  }

  function fallbackDownload(format, content, filename) {
    try {
      const mime = format === 'json' ? 'application/json' : format === 'html' ? 'text/html' : 'text/markdown';
      const ext = format === 'json' ? 'json' : format === 'html' ? 'html' : 'md';
      const blob = new Blob([content], { type: `${mime};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filename}.${ext}`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    } catch { return false; }
  }

  async function exportConversation(format = 'md', opts = {}) {
    if (exportState) {
      toast('已有导出任务正在进行');
      return false;
    }
    // Phase-3: 选中导出(仅 MD 入口用,JSON 保持全量语义由调用方决定);空选中给人话并中止
    const onlySelected = !!opts.onlySelected;
    if (onlySelected && selectedQKeys !== null && selectedQKeys.size === 0) {
      toast('请先勾选要导出的提问');
      return false;
    }
    const job = { cancelled: false, cancel() { this.cancelled = true; } };
    exportState = job;
    ensureExportProgress();
    try {
      const all = await collectAllTurns();
      if (!all.length) throw new Error('empty');
      const records = onlySelected ? filterRecordsByQ(all, selectedQKeys) : all;
      if (!records.length) {
        toast('请先勾选要导出的提问');
        return false;
      }
      const title = exportTitle();
      // 选中导出保持原 Q 号;selection 标签按 qOrder 顺序(Q2,Q5),全量记 all
      const sel = onlySelected && selectedQKeys !== null
        ? qOrder.filter(k => selectedQKeys.has(k)).map(k => 'Q' + qNumberOf(k)).join(',')
        : 'all';
      const content = buildExport(format, records, title, {
        selectionLabel: sel,
        qNumberOf: (k) => qNumberOf(k),
      });
      const filename = exportFilename(title);
      const response = await requestDownload({
        type: 'DOCDEEP_DOWNLOAD',
        format,
        filename,
        content,
      });
      const ok = response?.ok || fallbackDownload(format, content, filename);
      if (!ok) throw new Error('download');
      toast(format === 'json' ? 'JSON 已导出到下载目录' : format === 'html' ? 'HTML 已导出到下载目录' : 'Markdown 已导出到下载目录');
      return true;
    } catch (error) {
      if (error?.message === 'cancelled') toast('导出已取消');
      else {
        console.warn('[docdeep] export failed', error);
        toast('导出失败,请确认页面仍有对话内容');
      }
      return false;
    } finally {
      hideExportProgress();
      exportState = null;
    }
  }

  async function copyFull() {
    const turns = [...document.querySelectorAll('[data-docturn]')];
    if (!turns.length) return false;
    const parts = turns.map(el => {
      const t = cleanTurnText(el);
      if (!t) return null;
      if (el.getAttribute('data-docrole') === 'user' || (!el.getAttribute('data-docrole') && el.querySelector('.doc-qtag'))) {
        const key = keyForTurnEl(el, 'user', stripQuestionLabel(t));
        const n = qNumberOf(key) || 0;
        const head = n ? '## Q' + n + ' 我的提问' : '## 我的提问';
        return head + '\n\n' + t.replace(/^Q\d+ · 我的提问\s*/, '');
      }
      return t;
    }).filter(Boolean);
    const title = (document.title || '').replace(/\s*-\s*DeepSeek\s*$/, '').trim();
    const text = (title ? '# ' + title + '\n\n' : '') + parts.join('\n\n---\n\n');
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch { return false; }
    }
  }

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
            el, // 仅内存引用: 供原生目录隐藏打标用, 不进诊断快照
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
  function nativeOutlineSnapshot() {
    const d = probeNativeOutline();
    return {
      found: d.found,
      strategy: d.strategy,
      count: d.count,
      labelsHash: d.labelsHash,
      containerSig: d.containerSig,
      sample: d.sample,
      navHidden: (() => { try { return !!document.querySelector('[data-docnavhide="1"]'); } catch { return false; } })(),
    };
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

  // ---- 右侧大纲: Q + AI 内 h1/h2/h3 ----
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

  // Phase-3: 勾选栏(全选/清空/仅看已选/导出选中),挂载于补全按钮下、列表上,随大纲摘除
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
    const only = mk('仅看已选', '只显示已选提问', () => { onlySelectedView = !onlySelectedView; outlineDirty = true; buildOutline(); });
    const exp = mk('导出选中', '仅导出已选提问为 Markdown', () => { exportConversation('md', { onlySelected: true }); });
    exp.classList.add('doc-ol-sel-export');
    bar.append(all, none, only, exp);
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
    if (items.length < 2) {
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
            b.classList.toggle('doc-ol-sel-only', onlySelectedView);
          }
          if (b.getAttribute('aria-label') === '只显示已选提问') {
            b.classList.toggle('doc-ol-sel-only', onlySelectedView);
            b.textContent = onlySelectedView ? '显示全部' : '仅看已选';
          }
        });
      }
    } catch {}
    // 全量签名: 含稳定 key + 全局编号 + 标题文本 + 顺序, 条数/总长度不变但换序/替字也能检出
    // Task3: 追加过滤词, 仅显示层隐藏, olReg 保持全量, M/N 头逻辑复用上段不改算法
    // Phase-3: 追加选中签名 |s:(null记all,否则按qOrder顺序0/1串) + 仅看已选 |o:0/1
    const filter = ((box.querySelector('.doc-ol-filter')?.value || '').trim().toLowerCase());
    const selSig = selectedQKeys === null ? 'all' : qOrder.map(k => (selectedQKeys.has(k) ? '1' : '0')).join('');
    const matchItem = (it) => {
      if (onlySelectedView) {
        if (it.key) {
          if (selectedQKeys !== null && !selectedQKeys.has(it.key)) return false;
        } else if (it.owner !== '__head' && selectedQKeys !== null && !selectedQKeys.has(it.owner)) {
          return false;
        } else if (it.owner === '__head') {
          return false;
        }
      }
      if (!filter) return true;
      if (it.key) return ((it.label || '') + '\n' + (it.title || '')).toLowerCase().includes(filter);
      return (it.label || '').toLowerCase().includes(filter);
    };
    const signature = items.map(i => (i.key ? `q:${i.key}:${i.label}` : `h:${i.cls}:${i.label}`)).join('|') + '|f:' + filter + '|s:' + selSig + '|o:' + (onlySelectedView ? '1' : '0');
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
      lastUrl = location.href;
      qOrder = [];
      qInfo = new Map();
      liveElByKey = new Map();
      outlineSearchToken++;
      lastTurnOrder = [];
      outlineDirty = true;
      // Phase-3: 选中态与 qOrder 同命,URL 切换即清空
      selectedQKeys = null;
      onlySelectedView = false;
    }
    probeShell();
    applyNativeNavHide(); // NATIVE-NAV-HIDE-001: 容器重挂后每轮重打标(探测 5s 缓存)
    try { document.querySelectorAll('.doc-search').forEach(n => n.remove()); } catch {}
    ensureTools();
    // Q-INFLATE-001: 去嵌套(父 .ds-message 含子 [data-message-id] 时只留最外层),
    // 否则同一消息被计两次, 翻转/复用时抖动。
    const rawTurns = [...document.querySelectorAll(TURN_SEL)];
    const turns = rawTurns.filter(el => {
      try {
        const p = el.parentElement;
        return !(p && p.closest && p.closest(TURN_SEL));
      } catch { return true; }
    });
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
    heartbeat(false);
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

  // --- 启动 ---
  console.log('[docdeep] 内容脚本 v' + VERSION + ' 已加载');
  try { window.__DOCDEEP__ = { version: VERSION, snapshot }; } catch {}
  chrome.storage.local.get(DEFAULTS).then((s) => {
    applySettings(s);
    setOn(s.docdeep_enabled !== false);
    classify();
    console.log('[docdeep] 设置已应用', JSON.stringify({ w: settings.docdeep_width, f: settings.docdeep_font, t: settings.docdeep_theme }));
  });

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('scroll', scheduleSpy, true); // 捕获滚动(含虚拟列表), 仅做大纲高亮
  const rawPush = history.pushState;
  history.pushState = function (...a) { const r = rawPush.apply(this, a); schedule(); return r; };
  const rawRep = history.replaceState;
  history.replaceState = function (...a) { const r = rawRep.apply(this, a); schedule(); return r; };
  window.addEventListener('popstate', schedule);

  chrome.runtime.onMessage.addListener((msg, _s, send) => {
    if (msg?.type === 'DOCDEEP_PING') { send(snapshot()); return false; }
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
    ['docdeep_enabled', 'docdeep_width', 'docdeep_font', 'docdeep_theme', 'docdeep_outline', 'docdeep_keys', 'docdeep_hide_native'].forEach(k => {
      if (chg[k]) next[k] = chg[k].newValue;
    });
    applySettings({ ...settings, ...next });
    if ('docdeep_enabled' in next) setOn(next.docdeep_enabled !== false);
    classify();
  });
})();
