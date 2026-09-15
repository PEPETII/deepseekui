// 自测：富文本表面的 Enter 转发原语 — v0.3.37「Enter 交回站点原生链路」缺陷修复
// 复现路径：开启「选区格式工具栏」后输入文本按 Enter 不发送（扩展的按钮查找因站点无 form、
// 发送按钮为 div[role=button] 而恒为空）。修复改为把 Enter 转发给原生 textarea，由站点自身
// onKeyDown 处理；本用例覆盖转发判据（站点是否接管）与全部安全早退分支。
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../content.parts/04-rich-editor.js'), 'utf8');

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

class FakeKeyboardEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.key = init.key;
    this.code = init.code;
    this.bubbles = init.bubbles;
    this.cancelable = init.cancelable;
    this.composed = init.composed;
    this.defaultPrevented = false;
  }
  preventDefault() { this.defaultPrevented = true; }
}

// behavior: 'pass'（站点未接管）| 'prevent'（站点接管，dispatch 返回 false）
//          | 'prevent-return-true'（站点接管，但 dispatch 仍返回 true）| 'throw'
function makeTa(behavior) {
  return {
    isConnected: true,
    seen: null,
    dispatchEvent(ev) {
      this.seen = ev;
      if (behavior === 'throw') throw new Error('dispatch boom');
      if (behavior === 'prevent') { ev.preventDefault(); return false; }
      if (behavior === 'prevent-return-true') { ev.preventDefault(); return true; }
      return true;
    },
  };
}

function build(KeyboardEventImpl) {
  const body = extract('forwardEnterToNativeComposer');
  return new Function('KeyboardEvent', `${body}\nreturn forwardEnterToNativeComposer;`)(KeyboardEventImpl);
}

test('站点接管（dispatch 返回 false）→ 判为已转交', () => {
  const forward = build(FakeKeyboardEvent);
  const ta = makeTa('prevent');
  assert.strictEqual(forward(ta), true);
});

test('站点接管但 dispatch 仍返回 true → 依据 defaultPrevented 判为已转交', () => {
  const forward = build(FakeKeyboardEvent);
  const ta = makeTa('prevent-return-true');
  assert.strictEqual(forward(ta), true);
  assert.strictEqual(ta.seen.defaultPrevented, true);
});

test('站点未接管（未 preventDefault）→ 判为未转交，走回退', () => {
  const forward = build(FakeKeyboardEvent);
  const ta = makeTa('pass');
  assert.strictEqual(forward(ta), false);
  assert.strictEqual(ta.seen.defaultPrevented, false);
});

test('派发的事件是纯 Enter keydown，且可冒泡、可取消、可跨影子边界', () => {
  const forward = build(FakeKeyboardEvent);
  const ta = makeTa('prevent');
  forward(ta);
  assert.strictEqual(ta.seen.type, 'keydown');
  assert.strictEqual(ta.seen.key, 'Enter');
  assert.strictEqual(ta.seen.code, 'Enter');
  assert.strictEqual(ta.seen.bubbles, true);
  assert.strictEqual(ta.seen.cancelable, true);
  assert.strictEqual(ta.seen.composed, true);
});

test('textarea 缺失 → 安全返回 false', () => {
  const forward = build(FakeKeyboardEvent);
  assert.strictEqual(forward(null), false);
  assert.strictEqual(forward(undefined), false);
});

test('textarea 已断连 → 安全返回 false，不派发', () => {
  const forward = build(FakeKeyboardEvent);
  const ta = makeTa('prevent');
  ta.isConnected = false;
  assert.strictEqual(forward(ta), false);
  assert.strictEqual(ta.seen, null);
});

test('dispatchEvent 抛异常 → 安全返回 false，不向上抛', () => {
  const forward = build(FakeKeyboardEvent);
  const ta = makeTa('throw');
  assert.strictEqual(forward(ta), false);
});

test('KeyboardEvent 构造器不可用 → 安全返回 false，不抛错', () => {
  const forward = build(undefined);
  const ta = makeTa('prevent');
  assert.strictEqual(forward(ta), false);
  assert.strictEqual(ta.seen, null);
});
