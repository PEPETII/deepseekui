// 自测：选区「添加到输入框」纯函数 —— composeComposerInsert（v0.3.31）与
// addBoxAnchorPosition（v0.3.33 锚点下移：默认贴选区末行下方，避开 Edge 原生选中菜单）
// 覆盖：末尾追加分段 / 中段插入 / 选区替换 / 空文本 / 越界与非法输入；
//       下方优先 / 上方回落 / 视口钳制 / 右端越界 / 非法输入
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// 从源文件提取纯函数（无外部依赖），与 isolated world 拆函数单测同款做法
const src = fs.readFileSync(path.join(__dirname, '../content.parts/07-addtobox.js'), 'utf8');

function extract(name) {
  const start = src.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `${name} 存在`);
  let depth = 0;
  const open = src.indexOf('{', start);
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return src.slice(start, j + 1); }
  }
  throw new Error('braces');
}

const composeComposerInsert = new Function(`${extract('composeComposerInsert')}\nreturn composeComposerInsert;`)();
const addBoxAnchorPosition = new Function(`${extract('addBoxAnchorPosition')}\nreturn addBoxAnchorPosition;`)();

test('空正文末尾插入：原样落入，不加分段', () => {
  const r = composeComposerInsert('', 0, 0, '这段怎么理解？');
  assert.equal(r.value, '这段怎么理解？');
  assert.equal(r.caret, '这段怎么理解？'.length);
  assert.equal(r.changed, true);
});

test('追加到非空草稿末尾：自动补空行分段，不与末行粘连', () => {
  const r = composeComposerInsert('已有草稿', 4, 4, '追问内容');
  assert.equal(r.value, '已有草稿\n\n追问内容');
  assert.equal(r.caret, '已有草稿\n\n追问内容'.length);
});

test('草稿末尾已有单个换行：只补一个换行成空行分段', () => {
  const r = composeComposerInsert('草稿\n', 3, 3, '追问');
  assert.equal(r.value, '草稿\n\n追问');
});

test('草稿末尾已有空行分段：不再额外加分隔', () => {
  const r = composeComposerInsert('草稿\n\n', 4, 4, '追问');
  assert.equal(r.value, '草稿\n\n追问');
});

test('光标在中间：原样插入，不加分段', () => {
  const r = composeComposerInsert('abcdef', 3, 3, 'XX');
  assert.equal(r.value, 'abcXXdef');
  assert.equal(r.caret, 5);
});

test('选区替换：区间被替换且不加分段', () => {
  const r = composeComposerInsert('abcdef', 2, 4, 'XY');
  assert.equal(r.value, 'abXYef');
  assert.equal(r.caret, 4);
});

test('空文本：changed 为 false，原值与光标不变', () => {
  const r = composeComposerInsert('abc', 1, 2, '');
  assert.equal(r.changed, false);
  assert.equal(r.value, 'abc');
  assert.equal(r.caret, 2);
  const r2 = composeComposerInsert('abc', 1, 2, null);
  assert.equal(r2.changed, false);
  assert.equal(r2.value, 'abc');
});

test('越界索引钳制：负值归 0，超界归长度', () => {
  const r = composeComposerInsert('abc', -10, 999, 'X');
  assert.equal(r.value, 'X'); // start/end 都钳进 [0,3]，等价全量替换
  const r2 = composeComposerInsert('abc', 999, -5, 'X');
  assert.equal(r2.value, 'abc\n\nX'); // start 钳到 3 且光标在末尾 = 追加语义
});

test('选区替换延伸到末尾：原样替换，不触发追加分段', () => {
  const r = composeComposerInsert('abc', 2, 999, 'X');
  assert.equal(r.value, 'abX');
  assert.equal(r.caret, 3);
});

test('非法输入：非数值索引按末尾追加处理，非字符串 value 兜底空串', () => {
  const r = composeComposerInsert(null, undefined, undefined, 'X');
  assert.equal(r.value, 'X');
  assert.equal(r.changed, true);
  const r2 = composeComposerInsert(undefined, NaN, NaN, 'X');
  assert.equal(r2.value, 'X');
});

test('start > end 时回落为光标插入而非抛错', () => {
  const r = composeComposerInsert('abc', 2, 1, 'X');
  assert.equal(r.value, 'abXc');
});

// ---- addBoxAnchorPosition：锚点下移（v0.3.33）----

const BTN = { width: 100, height: 30 };

test('默认贴选区末行下方：top = anchor.bottom + 6', () => {
  const p = addBoxAnchorPosition({ top: 100, bottom: 124, right: 300 }, BTN, 1200, 800);
  assert.equal(p.top, 130);
  assert.equal(p.left, 306);
});

test('下方放不下、上方有空间：回落到选区上方', () => {
  // 选区末行 bottom=780，下方只剩 20px（按钮 30px 放不下）→ 回落 top=100 上方
  const p = addBoxAnchorPosition({ top: 100, bottom: 780, right: 300 }, BTN, 1200, 800);
  assert.equal(p.top, 100 - 30 - 6);
});

test('两头都放不下：钳回视口内（贴上边 8px）', () => {
  // 按钮比可用空间高：bottom 超界、top 回落后为负 → 钳到 8
  const p = addBoxAnchorPosition({ top: 10, bottom: 792, right: 300 }, { width: 100, height: 60 }, 1200, 800);
  assert.equal(p.top, 8);
});

test('右端越界：left 钳回视口内（留 8px）', () => {
  const p = addBoxAnchorPosition({ top: 100, bottom: 124, right: 1190 }, BTN, 1200, 800);
  assert.equal(p.left, 1200 - 100 - 8);
});

test('右端越界且按钮过宽：left 不小于 8px', () => {
  const p = addBoxAnchorPosition({ top: 100, bottom: 124, right: 1190 }, { width: 1200, height: 30 }, 1200, 800);
  assert.equal(p.left, 8);
});

test('非法输入：anchor/btn 为 null 时不抛错并钳回视口兜底', () => {
  const p = addBoxAnchorPosition(null, null, 1200, 800);
  assert.equal(p.left, 8);
  assert.equal(p.top, 8); // bottom=0+6=6，贴边钳到 8
});
