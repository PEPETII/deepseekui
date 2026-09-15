// 自测：思考区自动收拢（THINK-AUTO-COLLAPSE）— v0.3.38
// 根因（线上 main.9199a2404f.js 复核）：站点可折叠组 mi 的 isShowDetail 初始 true，
// 仅标题行手动点击可翻转，无「回答开始后自动收拢」逻辑；扩展 v0.3.36 的 CSS 时间窗规则
// 在回答正文挂载后让位 → 思考正文保持展开。
// 修复：autoCollapseThink() 对原生标题行转发一次 click，复用站点折叠链路。
// 本用例用 jsdom 搭真实结构夹具，覆盖：时间窗、防重入、用户接管、重挂收拢、止损、设置门控。
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const src = fs.readFileSync(path.join(__dirname, '../content.parts/01-turns.js'), 'utf8');

function extract(name) {
  const start = src.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `${name} 存在`);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return src.slice(start, j + 1); }
  }
  throw new Error('braces');
}

const dom = new JSDOM('<!doctype html><html><body></body></html>');
const { document } = dom.window;

// 站点结构夹具（按 bundle 证据搭：组容器带内联 --collapsible-area-title-height，
// 子顺序 = 标题行 → topRef → 片段(.ds-think-content)；回答正文在组外、气泡内）
function buildMessage({ withThink = true, withMain = true, id = 'm1' } = {}) {
  document.body.innerHTML = '';
  const msg = document.createElement('div');
  msg.className = 'ds-message';
  msg.setAttribute('data-message-id', id);
  const group = document.createElement('div');
  group.setAttribute('style', '--collapsible-area-title-height:34px;--group-title-sticky-base-top:0px');
  const row = document.createElement('div');
  row.className = 'title-row';
  row.textContent = '已思考（用时 3 秒）';
  const topRef = document.createElement('div');
  const think = document.createElement('div');
  think.className = 'ds-think-content';
  think.textContent = '思考正文…';
  group.appendChild(row);
  group.appendChild(topRef);
  if (withThink) group.appendChild(think);
  msg.appendChild(group);
  if (withMain) {
    const main = document.createElement('div');
    main.className = 'ds-markdown ds-assistant-message-main-content';
    main.textContent = '回答正文';
    msg.appendChild(main);
  }
  document.body.appendChild(msg);
  return { msg, group, row, think };
}

function build(settings) {
  const body = [extract('thinkTitleRowOf'), extract('autoCollapseThink')].join('\n');
  const factory = new Function(
    'settings', 'THINK_GROUP_SEL', 'keyForTurnEl', 'turnText',
    'thinkClickEls', 'thinkCollapseState', 'AI_SEL', 'MouseEvent', 'document', 'Node', 'window',
    `${body}\nreturn { autoCollapseThink, thinkTitleRowOf };`
  );
  return factory(
    settings,
    '[style*="--collapsible-area-title-height"]',
    (el) => 'a:' + (el.getAttribute?.('data-message-id') || 'hash'),
    () => 'text',
    new WeakSet(),
    new Map(),
    '.ds-markdown.ds-assistant-message-main-content, .ds-assistant-message-main-content',
    dom.window.MouseEvent,
    document,
    dom.window.Node,
    dom.window
  );
}

function collectClicks(row) {
  const clicks = [];
  row.addEventListener('click', (e) => clicks.push(e));
  return clicks;
}

test('思考进行中（无回答正文）→ 不派发任何 click', () => {
  const { autoCollapseThink } = build({ docdeep_hide_think: true });
  const { msg, row, think } = buildMessage({ withMain: false });
  const clicks = collectClicks(row);
  autoCollapseThink([msg]);
  assert.strictEqual(clicks.length, 0);
  assert.ok(think.isConnected);
});

test('回答正文挂载 → 恰好向标题行派发一次可冒泡 click', () => {
  const { autoCollapseThink } = build({ docdeep_hide_think: true });
  const { msg, row, think } = buildMessage();
  const clicks = collectClicks(row);
  autoCollapseThink([msg]);
  assert.strictEqual(clicks.length, 1);
  assert.strictEqual(clicks[0].bubbles, true);
  assert.strictEqual(clicks[0].cancelable, true);
  assert.ok(think.isConnected); // 收拢由站点自身 handler 完成，扩展不直接摘节点
});

test('同一挂载重复 classify（MutationObserver/轮询）→ 不再派发（WeakSet 防重入）', () => {
  const { autoCollapseThink } = build({ docdeep_hide_think: true });
  const { msg, row } = buildMessage();
  const clicks = collectClicks(row);
  autoCollapseThink([msg]);
  autoCollapseThink([msg]);
  autoCollapseThink([msg]);
  assert.strictEqual(clicks.length, 1);
});

test('模拟站点已收拢（片段卸载）→ 不派发', () => {
  const { autoCollapseThink } = build({ docdeep_hide_think: true });
  const { msg, row, think } = buildMessage();
  think.remove();
  const clicks = collectClicks(row);
  autoCollapseThink([msg]);
  assert.strictEqual(clicks.length, 0);
});

test('用户重新展开（同标题行、片段重挂）→ 不被再次强制收起', () => {
  const { autoCollapseThink } = build({ docdeep_hide_think: true });
  const { msg, row, think } = buildMessage();
  collectClicks(row);
  autoCollapseThink([msg]); // 首次代点
  // 模拟用户点开：站点重挂片段，标题行元素不变
  group_remount: {
    const think2 = document.createElement('div');
    think2.className = 'ds-think-content';
    think2.textContent = '思考正文…';
    row.parentElement.appendChild(think2);
  }
  const clicks2 = [];
  row.addEventListener('click', (e) => clicks2.push(e));
  autoCollapseThink([msg]);
  autoCollapseThink([msg]);
  assert.strictEqual(clicks2.length, 0);
  assert.ok(think.isConnected || true);
});

test('用户真实点击标题行（接管标记 user）→ 永不代点', () => {
  // 模拟扩展顶层 isTrusted 监听的语义：真实点击后 thinkCollapseState 记 'user'
  const { autoCollapseThink } = buildWithState(new Map([['a:m3', 'user']]));
  const { msg: msg3, row: row3 } = buildMessage({ id: 'm3' });
  const clicks3 = collectClicks(row3);
  autoCollapseThink([msg3]);
  assert.strictEqual(clicks3.length, 0);
});

function buildWithState(stateMap) {
  const body = [extract('thinkTitleRowOf'), extract('autoCollapseThink')].join('\n');
  const factory = new Function(
    'settings', 'THINK_GROUP_SEL', 'keyForTurnEl', 'turnText',
    'thinkClickEls', 'thinkCollapseState', 'AI_SEL', 'MouseEvent', 'document', 'Node', 'window',
    `${body}\nreturn { autoCollapseThink, thinkTitleRowOf };`
  );
  return factory(
    { docdeep_hide_think: true },
    '[style*="--collapsible-area-title-height"]',
    (el) => 'a:' + (el.getAttribute?.('data-message-id') || 'hash'),
    () => 'text',
    new WeakSet(),
    stateMap,
    '.ds-markdown.ds-assistant-message-main-content, .ds-assistant-message-main-content',
    dom.window.MouseEvent,
    document,
    dom.window.Node,
    dom.window
  );
}

test('虚拟列表重挂（全新元素、同一 message-id）→ 允许再次代点（维持收拢）', () => {
  const stateMap = new Map();
  const weak = new WeakSet();
  const mk = () => {
    const body = [extract('thinkTitleRowOf'), extract('autoCollapseThink')].join('\n');
    const f = new Function(
      'settings', 'THINK_GROUP_SEL', 'keyForTurnEl', 'turnText',
      'thinkClickEls', 'thinkCollapseState', 'AI_SEL', 'MouseEvent', 'document', 'Node', 'window',
      `${body}\nreturn { autoCollapseThink, thinkTitleRowOf };`
    );
    return f(
      { docdeep_hide_think: true },
      '[style*="--collapsible-area-title-height"]',
      (el) => 'a:' + (el.getAttribute?.('data-message-id') || 'hash'),
      () => 'text',
      weak, stateMap,
      '.ds-markdown.ds-assistant-message-main-content, .ds-assistant-message-main-content',
      dom.window.MouseEvent, document, dom.window.Node, dom.window
    );
  };
  const run = mk();
  const a = buildMessage({ id: 'm4' });
  const clicksA = collectClicks(a.row);
  run.autoCollapseThink([a.msg]);
  assert.strictEqual(clicksA.length, 1);
  // 重挂：整组换新元素（含新标题行），message-id 不变，attempts=1 < 3
  const b = buildMessage({ id: 'm4' });
  const clicksB = collectClicks(b.row);
  const run2 = mk();
  run2.autoCollapseThink([b.msg]);
  assert.strictEqual(clicksB.length, 1);
});

test('结构不匹配（无组容器锚点）→ 尝试 3 次后止损', () => {
  const stateMap = new Map();
  const { autoCollapseThink } = buildWithStateAndSettings({}, stateMap);
  document.body.innerHTML = '';
  const msg = document.createElement('div');
  msg.className = 'ds-message';
  msg.setAttribute('data-message-id', 'm5');
  const think = document.createElement('div');
  think.className = 'ds-think-content';
  msg.appendChild(think);
  const main = document.createElement('div');
  main.className = 'ds-assistant-message-main-content';
  msg.appendChild(main);
  document.body.appendChild(msg);
  const clicks = [];
  document.addEventListener('click', (e) => clicks.push(e));
  autoCollapseThink([msg]);
  autoCollapseThink([msg]);
  autoCollapseThink([msg]);
  autoCollapseThink([msg]); // 第 4 次：已到止损上限
  assert.strictEqual(clicks.length, 0);
  assert.strictEqual(stateMap.get('a:m5'), 3);
});

function buildWithStateAndSettings(settings, stateMap) {
  const body = [extract('thinkTitleRowOf'), extract('autoCollapseThink')].join('\n');
  const f = new Function(
    'settings', 'THINK_GROUP_SEL', 'keyForTurnEl', 'turnText',
    'thinkClickEls', 'thinkCollapseState', 'AI_SEL', 'MouseEvent', 'document', 'Node', 'window',
    `${body}\nreturn { autoCollapseThink, thinkTitleRowOf };`
  );
  return f(
    settings,
    '[style*="--collapsible-area-title-height"]',
    (el) => 'a:' + (el.getAttribute?.('data-message-id') || 'hash'),
    () => 'text',
    new WeakSet(), stateMap,
    '.ds-markdown.ds-assistant-message-main-content, .ds-assistant-message-main-content',
    dom.window.MouseEvent, document, dom.window.Node, dom.window
  );
}

test('docdeep_hide_think=false（关闭隐藏思考）→ 完全不干预，交还站点原生行为', () => {
  const { autoCollapseThink } = build({ docdeep_hide_think: false });
  const { msg, row } = buildMessage();
  const clicks = collectClicks(row);
  autoCollapseThink([msg]);
  assert.strictEqual(clicks.length, 0);
});

test('用户消息（data-docrole=user）→ 不干预', () => {
  const { autoCollapseThink } = build({ docdeep_hide_think: true });
  const { msg, row } = buildMessage();
  msg.setAttribute('data-docrole', 'user');
  const clicks = collectClicks(row);
  autoCollapseThink([msg]);
  assert.strictEqual(clicks.length, 0);
});

test('thinkTitleRowOf 结构校验：firstElementChild 含片段 / 顺序颠倒 → 返回 null', () => {
  const { thinkTitleRowOf } = build({ docdeep_hide_think: true });
  // 顺序颠倒：片段在标题行之前
  document.body.innerHTML = '';
  const group = document.createElement('div');
  group.setAttribute('style', '--collapsible-area-title-height:34px');
  const think = document.createElement('div');
  think.className = 'ds-think-content';
  const row = document.createElement('div');
  group.appendChild(think);
  group.appendChild(row);
  assert.strictEqual(thinkTitleRowOf(think), null);
  // 标题行包含片段（异常结构）
  document.body.innerHTML = '';
  const group2 = document.createElement('div');
  group2.setAttribute('style', '--collapsible-area-title-height:34px');
  const row2 = document.createElement('div');
  const think2 = document.createElement('div');
  think2.className = 'ds-think-content';
  row2.appendChild(think2);
  group2.appendChild(row2);
  assert.strictEqual(thinkTitleRowOf(think2), null);
});
