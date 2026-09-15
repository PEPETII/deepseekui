// 自测：富文本表面空态标记（占位符显隐）随同步刷新 — 回归 0.3.29 占位符不消失缺陷
// 复现路径：开启选区格式工具栏后直接在编辑器打字，handleRichInput 不经过 renderRichModel，
// 修复前 data-docdeep-empty 停留在 "true"，占位符与正文同时显示。
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

// 从源文件提取 syncTextareaFromRich 与其最小依赖，用桩 DOM 验证行为
const fs = require('node:fs');
const src = fs.readFileSync(require('node:path').join(__dirname, '../content.parts/03-rich-model.js'), 'utf8');

function extract(name) {
  const start = src.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `${name} 存在`);
  let depth = 0, i = src.indexOf('{', start);
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return src.slice(start, j + 1); }
  }
  throw new Error('braces');
}

// 桩：readRichModel 由外部作用域提供（同 isolated world 顶层作用域语义）
const readRichModel = () => ({ blocks: [{ kind: 'text', runs: [{ text: '' }] }] });
const richModelApi = {
  serializeMarkdown: (m) => (m && m.blocks ? m.blocks.map(b => b.runs.map(r => r.text).join('')).join('\n\n') : ''),
  parseMarkdown: (v) => ({ blocks: v ? [{ kind: 'text', runs: [{ text: v }] }] : [{ kind: 'text', runs: [{ text: '' }] }] }),
  normalizeModel: (m) => m,
  modelTextLength: () => 0,
};
const richModel = () => richModelApi;

function makeTa(initial) {
  return { value: initial || '', isConnected: true, listeners: [], dispatchEvent(e) { this.listeners.forEach(fn => fn(e)); }, addEventListener(t, fn) { this.listeners.push(fn); } };
}
function makeEditor() { return { isConnected: true, dataset: {} }; }
function makeBinding(ta, editor) {
  return { textarea: ta, editor, model: null, lastSerialized: null, syncing: false };
}

function buildFn() {
  const body = extract('syncTextareaFromRich');
  const dispatchTextareaInput = () => {};
  return new Function('readRichModel', 'richModel', 'dispatchTextareaInput', `${body}\nreturn syncTextareaFromRich;`)(readRichModel, richModel, dispatchTextareaInput);
}

test('打字后空态标记翻转为 false（占位符应消失）', () => {
  const sync = buildFn();
  const ta = makeTa('');
  const editor = makeEditor();
  const binding = makeBinding(ta, editor);
  editor.dataset.docdeepEmpty = 'true'; // 初始空态
  binding.model = { blocks: [{ kind: 'text', runs: [{ text: '测试文本' }] }] };
  const value = sync(binding, binding.model);
  assert.strictEqual(value, '测试文本');
  assert.strictEqual(editor.dataset.docdeepEmpty, 'false');
  assert.strictEqual(ta.value, '测试文本');
});

test('删空后空态标记翻回 true（占位符应重新显示）', () => {
  const sync = buildFn();
  const ta = makeTa('测试文本');
  const editor = makeEditor();
  const binding = makeBinding(ta, editor);
  editor.dataset.docdeepEmpty = 'false';
  binding.model = { blocks: [{ kind: 'text', runs: [{ text: '' }] }] };
  sync(binding, binding.model);
  assert.strictEqual(editor.dataset.docdeepEmpty, 'true');
  assert.strictEqual(ta.value, '');
});

test('值未变化（含空→空）时标记仍被刷新', () => {
  const sync = buildFn();
  const ta = makeTa('');
  const editor = makeEditor();
  const binding = makeBinding(ta, editor);
  editor.dataset.docdeepEmpty = 'true';
  binding.model = { blocks: [{ kind: 'text', runs: [{ text: '' }] }] };
  const value = sync(binding, binding.model); // value === ta.value，走早退分支
  assert.strictEqual(value, '');
  assert.strictEqual(editor.dataset.docdeepEmpty, 'true');
  // 有内容且与 ta 一致时也不能漏刷
  ta.value = 'abc';
  binding.model = { blocks: [{ kind: 'text', runs: [{ text: 'abc' }] }] };
  editor.dataset.docdeepEmpty = 'true'; // 模拟缺陷态
  sync(binding, binding.model);
  assert.strictEqual(editor.dataset.docdeepEmpty, 'false');
});

test('textarea 断连时安全早退，不抛错', () => {
  const sync = buildFn();
  const ta = makeTa('');
  ta.isConnected = false;
  const editor = makeEditor();
  const binding = makeBinding(ta, editor);
  assert.strictEqual(sync(binding, { blocks: [] }), '');
  assert.strictEqual(editor.dataset.docdeepEmpty, undefined);
});

test('编辑器断连时跳过标记写入但不影响 textarea 同步', () => {
  const sync = buildFn();
  const ta = makeTa('');
  const editor = makeEditor();
  editor.isConnected = false;
  const binding = makeBinding(ta, editor);
  binding.model = { blocks: [{ kind: 'text', runs: [{ text: 'x' }] }] };
  sync(binding, binding.model);
  assert.strictEqual(ta.value, 'x');
  assert.strictEqual(editor.dataset.docdeepEmpty, undefined);
});

test('序列化空值不含占位符文本（发送内容不携带占位符）', () => {
  const sync = buildFn();
  const ta = makeTa('');
  const editor = makeEditor();
  const binding = makeBinding(ta, editor);
  editor.dataset.docdeepPlaceholder = '给 DeepSeek 发送消息';
  binding.model = { blocks: [{ kind: 'text', runs: [{ text: '' }] }] };
  const value = sync(binding, binding.model);
  assert.strictEqual(value.includes('给 DeepSeek 发送消息'), false);
});
