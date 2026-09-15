'use strict';
  function toast(text) {
    document.querySelectorAll('#docdeep-toast').forEach(n => n.remove());
    const t = document.createElement('div');
    t.id = 'docdeep-toast';
    t.className = INJECTED;
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  function turnText(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.' + INJECTED).forEach(n => n.remove());
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // Q-INFLATE-001: 去嵌套(父 .ds-message 含子 [data-message-id] 时只留最外层),
  // 否则同一消息被计两次, 翻转/复用时抖动。
  function queryTurns() {
    const raw = [...document.querySelectorAll(TURN_SEL)];
    return raw.filter(el => {
      try {
        const p = el.parentElement;
        return !(p && p.closest && p.closest(TURN_SEL));
      } catch { return true; }
    });
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