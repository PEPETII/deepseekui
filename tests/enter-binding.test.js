// 自测：富文本编辑器的 keydown 接线回归 — v0.3.39「Enter 绑定缺失」缺陷修复
// 复现路径：开启「选区格式工具栏」后在输入框按 Enter 只换行不发送。
// 根因：bindRichEditor 内定义了 keydown（含 Enter 转发分支），但 events 数组漏掉了
// ['keydown', keydown]，监听从未挂到编辑器上，转发逻辑成死代码。
// 本用例做静态接线断言：handler 定义存在，且被注册到编辑器的监听列表中。
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

const bindBody = extract('bindRichEditor');

test('keydown handler 在 bindRichEditor 内有定义', () => {
  assert.ok(bindBody.includes('const keydown = (e) =>'), 'keydown handler 定义存在');
});

test('keydown handler 被注册进编辑器监听列表', () => {
  assert.ok(
    bindBody.includes("['keydown', keydown]"),
    "events 数组必须含 ['keydown', keydown]，否则 Enter 转发成死代码"
  );
});

test('监听经 events 数组统一挂载到编辑器且纳入卸载 bookkeeping', () => {
  assert.ok(
    bindBody.includes('events.forEach(([type, handler]) => editor.addEventListener(type, handler))'),
    'events 数组统一 addEventListener 到 editor'
  );
  assert.ok(
    bindBody.includes('binding.listeners = events.map('),
    'events 数组纳入 binding.listeners，removeRichEditor 可卸载'
  );
});

test('Enter 分支仍是转发优先 + 回退，且前置守卫未被放宽', () => {
  assert.ok(bindBody.includes('forwardEnterToNativeComposer(textarea)'), '转发主路径存在');
  assert.ok(bindBody.includes('nativeComposerSendButton(textarea)'), '回退路径保留');
  assert.ok(
    bindBody.includes("e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229"),
    'Shift+Enter 换行 / IME 组合期不接管的守卫未改'
  );
});
