/* deepseek ui - 对话队列纯逻辑层
 * 无 DOM / 无网络 / 无 chrome / 无第三方依赖；供 content.js 的队列运行时与 Node 测试共用。
 * 本文件只做三件事：把用户粘贴的文本切成条目、判定发送/停止按钮语义、推进队列状态机。
 * 真正的发送与「生成是否结束」的采样由 content.js 负责（DOM 适配层），
 * 因此这里的 reducer 只产出 effects 声明（send / toast），不执行任何副作用。
 */
(() => {
  'use strict';

  const QUEUE_MAX = 20;   // 单次入队条数上限（风控与 UI 双重考虑）
  const ITEM_MAX = 4000;  // 单条消息字符上限，超出判为跳过而不是静默截断

  // 判定阈值集中在这里：实机调参只改这一处，不改判定结构。
  const TUNING = {
    pollMs: 600,          // 采样间隔
    guardStartMs: 15000,  // 发出后多久没出现任何生成迹象即判 no-start
    guardTotalMs: 240000, // 单条回答的总看门狗
    gapMs: 2000,          // 上一条答完到下一条发出之间的最小间隔
    stableTicks: 2,       // 观察到停止按钮时：静默多少次采样算结束
    stableMs: 1200,       // 观察到停止按钮时：静默时长的下限
    fallbackTicks: 6,     // 未观察到停止按钮（站点改版）时的降级阈值
    fallbackMs: 4000,     // 同上，需更长的静默才敢判定
  };

  // 行首有序 / 无序标记。`.` 与项目符号后要求空白，避免把 "1.5 倍" 这类正文误剥。
  const MARKER_RE = new RegExp(
    '^(?:'
    + '[-*\u2022\u00b7]\\s+'
    + '|\\d{1,3}\\s*[、)）]\\s*'
    + '|\\d{1,3}\\s*\\.\\s+'
    + '|[一二三四五六七八九十]{1,3}\\s*[、.]\\s*'
    + '|[（(【\\[]\\s*\\d{1,3}\\s*[)）】\\]]\\s*'
    + ')'
  );

  const STOP_RE = /停止|中断|interrupt|stop|abort/i;
  const SEND_RE = /发送|send|submit/i;

  const STATUS = { IDLE: 'idle', RUNNING: 'running', PAUSED: 'paused', DONE: 'done' };

  const PHASE_LABEL = {
    idle: '',
    send: '准备发送',
    await: '等待回答开始',
    stream: '回答生成中',
    gap: '等待下一条',
  };

  function hasMarker(line) {
    return MARKER_RE.test(String(line || '').trim());
  }

  function stripMarker(line) {
    return String(line || '').replace(MARKER_RE, '').trim();
  }

  // 单行编号列表启发式：仅当文本没有换行、且能找到从 1 起连续递增的编号标记时才切分。
  // 例："1. 甲；2. 乙；3. 丙" -> 三条。任一条不满足即返回 null，交给逐行解析。
  function splitInlineNumbered(text) {
    const s = String(text || '');
    if (s.includes('\n')) return null;
    const re = /(?:^|[\s；;。])\s*(\d{1,2})\s*[.、)）]\s*/g;
    const marks = [];
    let m;
    while ((m = re.exec(s))) {
      const head = m[0].match(/^[\s；;。]/) ? 1 : 0;
      marks.push({ label: Number(m[1]), start: m.index, head, end: m.index + m[0].length });
      if (marks.length > 200) break;
    }
    if (marks.length < 2 || marks[0].label !== 1) return null;
    const picked = [marks[0]];
    for (let i = 1; i < marks.length; i += 1) {
      if (marks[i].label === picked[picked.length - 1].label + 1) picked.push(marks[i]);
    }
    if (picked.length < 2) return null;
    // 分隔符（；/。/空白）是被下一条的标记匹配吃掉的，所以上一条到「下一个标记起点」为止，
    // 不能再把 head 加回去，否则每条都会拖着前一个分隔符。
    return picked.map((mark, i) => {
      const from = mark.end;
      const to = i + 1 < picked.length ? picked[i + 1].start : s.length;
      return s.slice(from, to);
    });
  }

  // 文本 -> 条目。一行一条（空行忽略）；仅当有两条以上、且所有非空行都带有序标记时才统一剥离。
  function parseQueueText(raw) {
    const text = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n');
    if (!text.trim()) return { items: [], skipped: 0, overflow: 0, tooLong: 0, reason: '内容为空' };
    let lines = text.split('\n');
    if (lines.length === 1) {
      const inline = splitInlineNumbered(text);
      if (inline) lines = inline;
    }
    const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);
    if (!nonEmpty.length) return { items: [], skipped: 0, overflow: 0, tooLong: 0, reason: '内容为空' };
    // 只有一条时绝不剥离标记：单条消息改内容（"1. 帮我看看这段代码" 变成 "帮我看看这段代码"）
    // 比留下一个无伤大雅的编号更糟——发出去的内容必须与用户写的一致。
    const allMarked = nonEmpty.length > 1 && nonEmpty.every(hasMarker);
    const items = [];
    let overflow = 0;
    let tooLong = 0;
    let blank = 0;
    nonEmpty.forEach((line) => {
      const clean = (allMarked ? stripMarker(line) : line).trim();
      if (!clean) { blank += 1; return; }
      if (clean.length > ITEM_MAX) { tooLong += 1; return; }
      if (items.length >= QUEUE_MAX) { overflow += 1; return; }
      items.push(clean);
    });
    const skipped = overflow + tooLong + blank;
    const reason = !items.length ? '没有可用的消息'
      : overflow > 0 ? `超出 ${QUEUE_MAX} 条上限，已截断`
        : tooLong > 0 ? `有 ${tooLong} 条超过 ${ITEM_MAX} 字，已跳过`
          : '';
    return { items, skipped, overflow, tooLong, reason };
  }

  // 按钮语义判定：停止优先于发送——生成中「发送」按钮常原地变成「停止」，
  // 若先判发送会把停止按钮当成发送按钮点下去（等于打断回答）。
  function classifyComposerButton(btn) {
    const label = `${btn?.label || ''} ${btn?.testid || ''} ${btn?.title || ''}`.trim();
    if (label && STOP_RE.test(label)) return 'stop';
    if (btn?.type === 'submit') return 'send';
    if (label && SEND_RE.test(label)) return 'send';
    return 'other';
  }

  function isDisabled(btn) {
    return !!(btn?.disabled || btn?.ariaDisabled === true || btn?.ariaDisabled === 'true');
  }

  function initialQueueState(items) {
    const list = (Array.isArray(items) ? items : [])
      .filter((t) => typeof t === 'string' && t.trim())
      .slice(0, QUEUE_MAX);
    return {
      status: STATUS.IDLE,
      phase: 'idle',
      items: list,
      index: 0,
      attempts: 0,
      doneCount: 0,
      sawStop: false,
      lastLen: -1,
      stableTicks: 0,
      turnBase: 0,
      phaseAt: 0,
      lastChangeAt: 0,
      lastError: '',
      pendingResend: false,
      startedAt: 0,
    };
  }

  function idleState(reason) {
    const s = initialQueueState([]);
    s.lastError = String(reason || '');
    return s;
  }

  // 失败一律落到 PAUSED（而不是继续往下发）：宁可停在原地等用户决定，也不要连错多条。
  // pendingResend 只在「确定没发出去」或「还没点发送」时为真，避免重复发送同一条消息。
  function fail(state, effects, reason, message) {
    const next = { ...state, status: STATUS.PAUSED, lastError: reason, attempts: 0 };
    next.pendingResend = reason === 'no-start' || state.phase === 'send';
    effects.push({ type: 'toast', text: message });
    return { state: next, effects };
  }

  // 纯 reducer：返回 { state, effects }。effects 只声明该做什么，由调用方执行。
  function reduceQueue(state, event) {
    const now = Number(event?.now) || 0;
    const effects = [];
    let s = { ...state };

    switch (event?.type) {
      case 'START': {
        if (!s.items.length || s.status === STATUS.RUNNING) return { state: s, effects };
        s = {
          ...s,
          status: STATUS.RUNNING,
          phase: 'send',
          index: 0,
          attempts: 0,
          doneCount: 0,
          lastError: '',
          pendingResend: false,
          startedAt: now,
          phaseAt: now,
          lastChangeAt: now,
        };
        effects.push({ type: 'send' });
        break;
      }

      // 由 DOM 层在「写完输入框并点中发送按钮」之后回报
      case 'SENT': {
        if (s.status !== STATUS.RUNNING || s.phase !== 'send') return { state: s, effects };
        s = {
          ...s,
          phase: 'await',
          phaseAt: now,
          attempts: s.attempts + 1,
          sawStop: false,
          lastLen: -1,
          stableTicks: 0,
          lastChangeAt: now,
          turnBase: Number(event.turnCount) || 0,
        };
        break;
      }

      case 'SAMPLE': {
        if (s.status !== STATUS.RUNNING) return { state: s, effects };
        const hasStop = !!event.hasStop;
        const textLen = Number(event.textLen) || 0;
        const turnCount = Number(event.turnCount) || 0;

        if (s.phase === 'await') {
          if (hasStop || turnCount > s.turnBase) {
            s = { ...s, phase: 'stream', phaseAt: now, sawStop: hasStop, lastLen: textLen, stableTicks: 0, lastChangeAt: now };
          } else if (now - s.phaseAt > TUNING.guardStartMs) {
            return fail(s, effects, 'no-start', '发出后没有出现回答，队列已暂停');
          }
          break;
        }

        if (s.phase === 'stream') {
          let lastLen = s.lastLen;
          let stableTicks = s.stableTicks;
          let lastChangeAt = s.lastChangeAt;
          if (textLen !== lastLen) {
            lastLen = textLen;
            stableTicks = 0;
            lastChangeAt = now;
          } else {
            stableTicks += 1;
          }
          s = { ...s, sawStop: s.sawStop || hasStop, lastLen, stableTicks, lastChangeAt };
          const needTicks = s.sawStop ? TUNING.stableTicks : TUNING.fallbackTicks;
          const needMs = s.sawStop ? TUNING.stableMs : TUNING.fallbackMs;
          const quiet = !hasStop && stableTicks >= needTicks && (now - lastChangeAt) >= needMs && textLen > 0;
          if (quiet) {
            const finished = s.index + 1 >= s.items.length;
            s = {
              ...s,
              doneCount: s.doneCount + 1,
              attempts: 0,
              pendingResend: false,
            };
            if (finished) {
              s = { ...s, status: STATUS.DONE, phase: 'idle' };
              effects.push({ type: 'toast', text: `队列已完成 ${s.items.length} 条` });
            } else {
              s = { ...s, index: s.index + 1, phase: 'gap', phaseAt: now };
            }
          } else if (now - s.phaseAt > TUNING.guardTotalMs) {
            return fail(s, effects, 'timeout', '这一条等太久了，队列已暂停（可点继续再试）');
          }
          break;
        }

        if (s.phase === 'gap') {
          if (now - s.phaseAt >= TUNING.gapMs) {
            s = { ...s, phase: 'send', phaseAt: now };
            effects.push({ type: 'send' });
          }
        }
        break;
      }

      // DOM 层回报的硬失败：无输入框 / 正在生成 / 用户草稿 / 任务互斥 / 点击无效
      case 'FAIL':
        return fail(s, effects, event.reason || 'unknown', event.message || '队列已暂停');

      case 'PAUSE': {
        if (s.status !== STATUS.RUNNING) return { state: s, effects };
        // 用户主动暂停不算错误, 清掉上一次的失败原因, 免得面板一直挂着旧提示
        const userPause = event.reason === 'user';
        s = { ...s, status: STATUS.PAUSED, lastError: userPause ? '' : (event.reason || s.lastError) };
        effects.push({ type: 'toast', text: '队列已暂停' });
        break;
      }

      case 'RESUME': {
        if (s.status !== STATUS.PAUSED || !s.items.length) return { state: s, effects };
        const resend = s.pendingResend || s.phase === 'send' || s.phase === 'gap';
        s = { ...s, status: STATUS.RUNNING, phaseAt: now, lastChangeAt: now, stableTicks: 0, pendingResend: false, lastError: '' };
        if (resend) {
          s = { ...s, phase: 'send' };
          effects.push({ type: 'send' });
        }
        break;
      }

      case 'CLEAR':
        s = idleState('');
        break;

      case 'ABORT': {
        const had = s.items.length > 0;
        s = idleState(event.reason || '');
        if (had) {
          effects.push({
            type: 'toast',
            text: event.reason === 'url-changed' ? '会话已切换，队列已停止'
              : event.reason === 'off' ? '扩展已关闭，队列已停止'
                : '队列已停止',
          });
        }
        break;
      }

      default:
        break;
    }

    return { state: s, effects };
  }

  // 进度文案（注入面板与 popup 共用；纯函数，不读 DOM）
  function queueStatusText(state) {
    const total = Array.isArray(state?.items) ? state.items.length : 0;
    if (!total) return '队列为空';
    if (state.status === STATUS.DONE) return `已完成 ${total}/${total}`;
    const cur = Math.min(Math.max(state.index, 0) + 1, total);
    const head = `第 ${cur}/${total} 条`;
    if (state.status === STATUS.PAUSED) return `已暂停 · ${head}`;
    const phase = PHASE_LABEL[state.phase] || '';
    return phase ? `${head} · ${phase}` : head;
  }

  function queueErrorText(state) {
    const reason = String(state?.lastError || '');
    return {
      'no-start': '已发出但迟迟没有回答',
      'timeout': '这一条等待超时',
      'no-input': '没有找到输入框',
      'generating': '页面正在生成回答',
      'draft': '输入框里有未发送的草稿',
      'busy': '导出或补全正在进行',
      'send-noop': '发送按钮不可用',
    }[reason] || (reason ? '未知问题' : '');
  }

  const api = {
    QUEUE_MAX,
    ITEM_MAX,
    TUNING,
    STATUS,
    PHASE_LABEL,
    parseQueueText,
    splitInlineNumbered,
    hasMarker,
    stripMarker,
    classifyComposerButton,
    isDisabled,
    initialQueueState,
    reduceQueue,
    queueStatusText,
    queueErrorText,
  };

  if (typeof globalThis !== 'undefined') globalThis.DocDeepQueue = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
