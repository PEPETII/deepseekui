// 「模板」分区纯函数单测：模板档位映射 + 命中判定（无 DOM，无 chrome）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// popup 逻辑自物理拆分起分散在 popup.parts/*.js，由 popup.html 按序 <script> 加载、共享顶层作用域。
// Node 无共享脚本作用域，这里按原加载顺序就地拼接后求值，复现原 popup.js 的导出面；下方断言不变。
const POPUP_PARTS = ['00-core.js', '01-bookmarks.js', '02-themes.js', '03-entry.js'];
const popupSource = POPUP_PARTS
  .map(name => fs.readFileSync(path.resolve(__dirname, '..', 'popup.parts', name), 'utf8'))
  .join('\n');
const moduleShim = { exports: {} };
new Function('module', 'exports', popupSource)(moduleShim, moduleShim.exports);
const popup = moduleShim.exports;

const LEGAL_THEMES = ['mi', 'bai', 'mo'];

test('模板只暴露橙色 / 深色两档，并映射到现有主题档位', () => {
  assert.deepEqual(popup.TEMPLATES.map(t => t.id), ['mi', 'mo']);
  assert.deepEqual(popup.TEMPLATES.map(t => t.name), ['橙色', '深色']);
});

test('activeTemplate 命中已开模板，未命中档位返回 null 而不是误选', () => {
  assert.equal(popup.activeTemplate('mi'), 'mi');
  assert.equal(popup.activeTemplate('mo'), 'mo');
  assert.equal(popup.activeTemplate('bai'), null); // 纯白仍在「阅读」里，不占模板位
});

test('activeTemplate 对空值与脏数据不抛异常、不误选', () => {
  assert.equal(popup.activeTemplate(''), null);
  assert.equal(popup.activeTemplate(undefined), null);
  assert.equal(popup.activeTemplate(null), null);
  assert.equal(popup.activeTemplate('DARK'), null); // 不做大小写宽容，避免脏值被当成有效档位
  assert.equal(popup.activeTemplate('__proto__'), null);
});

test('默认主题落在「橙色」模板上（存量用户打开面板即见选中态）', () => {
  assert.equal(popup.activeTemplate(popup.DEFAULTS.docdeep_theme), 'mi');
});

test('模板 id 全部是合法主题档位且互不重复', () => {
  const ids = popup.TEMPLATES.map(t => t.id);
  ids.forEach(id => assert.ok(LEGAL_THEMES.includes(id), `${id} 不是合法主题档位`));
  assert.equal(new Set(ids).size, ids.length);
});

test('每个模板都有非空中文名与描述（避免空白卡片）', () => {
  popup.TEMPLATES.forEach(t => {
    assert.ok(String(t.name || '').trim(), '模板名不可为空');
    assert.ok(String(t.desc || '').trim(), '模板描述不可为空');
  });
});
