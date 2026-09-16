// 「模板」分区纯函数单测：模板档位映射 + 命中判定（无 DOM，无 chrome）
// 深色卡已于 v0.3.40 下线：TEMPLATES 仅剩橙色(mi)；mo/bai 仍是合法主题档位（THEME_SLOTS），只在「阅读」下拉可达
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// popup 逻辑自物理拆分起分散在 popup.parts/*.js，由 popup.html 按序 <script> 加载、共享顶层作用域。
// Node 无共享脚本作用域，这里按原加载顺序就地拼接后求值，复现原 popup.js 的导出面；下方断言不变。
const POPUP_PARTS = ['00-core.js', '01-bookmarks.js', '02-themes.js', '03-background.js', '03-entry.js'];
const popupSource = POPUP_PARTS
  .map(name => fs.readFileSync(path.resolve(__dirname, '..', 'popup.parts', name), 'utf8'))
  .join('\n');
const popupHtml = fs.readFileSync(path.resolve(__dirname, '..', 'popup.html'), 'utf8');
const moduleShim = { exports: {} };
new Function('module', 'exports', popupSource)(moduleShim, moduleShim.exports);
const popup = moduleShim.exports;

const LEGAL_THEMES = ['mi', 'bai', 'mo'];

test('模板只暴露橙色一档，并映射到现有主题档位', () => {
  assert.deepEqual(popup.TEMPLATES.map(t => t.id), ['mi']);
  assert.deepEqual(popup.TEMPLATES.map(t => t.name), ['橙色']);
});

test('主题档位全集仍含 mi/bai/mo（下拉可达），白名单以 THEME_SLOTS 为准', () => {
  assert.deepEqual(popup.THEME_SLOTS, ['mi', 'bai', 'mo']);
});

test('activeTemplate 只命中已开模板，mo/bai 返回 null 而不是误选', () => {
  assert.equal(popup.activeTemplate('mi'), 'mi');
  assert.equal(popup.activeTemplate('mo'), null); // 深色卡已下线，mo 只在「阅读」下拉可达
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

test('背景图默认配置开启，非法配置安全回退', () => {
  assert.equal(popup.DEFAULTS[popup.BACKGROUND_KEY].enabled, true);
  assert.equal(popup.normalizeTemplateBackground(undefined).enabled, true);
  assert.equal(popup.normalizeTemplateBackground({ enabled: false }).enabled, false);
  assert.equal(popup.normalizeTemplateBackground({ enabled: true, dataUrl: 'data:image/gif;base64,AAAA' }).dataUrl, '');
});

test('背景图文件校验覆盖 PNG/JPG、空文件和 5 MB 边界', () => {
  assert.equal(popup.validateBackgroundFile({ name: 'cover.png', type: 'image/png', size: 1 }).ok, true);
  assert.equal(popup.validateBackgroundFile({ name: 'cover.jpg', type: 'image/jpeg', size: 1 }).ok, true);
  assert.equal(popup.validateBackgroundFile({ name: 'cover.gif', type: 'image/gif', size: 1 }).ok, false);
  assert.equal(popup.validateBackgroundFile({ name: 'empty.png', type: 'image/png', size: 0 }).ok, false);
  assert.equal(popup.validateBackgroundFile({ name: 'max.png', type: 'image/png', size: popup.BACKGROUND_MAX_BYTES }).ok, true);
  assert.equal(popup.validateBackgroundFile({ name: 'large.png', type: 'image/png', size: popup.BACKGROUND_MAX_BYTES + 1 }).ok, false);
});

test('成功上传背景图会立即开启，避免上传后仍呈现关闭状态', () => {
  const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
  const next = popup.backgroundConfigAfterUpload({ enabled: false, dataUrl, width: 1920, height: 1080, size: 8 });
  assert.equal(next.enabled, true);
  assert.equal(next.dataUrl, dataUrl);
});

test('模板区包含开关、规格说明、预览和上传删除控件（导入导出模板已下线）', () => {
  for (const id of ['background-card', 'background-toggle', 'background-upload', 'background-remove', 'background-file', 'background-preview']) {
    assert.match(popupHtml, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(popupHtml, /template-export|template-import|template-file/);
  assert.doesNotMatch(popupSource, /buildTemplateExport|parseTemplateImport/);
  assert.match(popupHtml, /1920×1080（16:9）/);
  assert.match(popupHtml, /JPG\/JPEG、PNG/);
  assert.match(popupHtml, /5 MB/);
  assert.match(popupHtml, /popup\.parts\/03-background\.js/);
});

test('既有收藏导出 settings 也携带背景配置，兼容旧导出结构', () => {
  const background = { enabled: false, dataUrl: 'data:image/png;base64,iVBORw0KGgo=', size: 8, width: 1920, height: 1080 };
  const payload = popup.buildBookmarksExport({ [popup.BACKGROUND_KEY]: background }, [], new Date('2026-09-15T00:00:00Z'));
  const exported = JSON.parse(payload.content);
  assert.equal(exported.kind, 'bookmarks');
  assert.deepEqual(exported.settings[popup.BACKGROUND_KEY], popup.normalizeTemplateBackground(background));
});
