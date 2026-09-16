// 主页面大背景图专项静态/纯函数回归：不依赖浏览器、Chrome API 或 jsdom。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'content.parts', '12-page-background.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'content.parts', '10-page-background.css'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const runtime = fs.readFileSync(path.join(root, 'content.parts', '00-runtime.js'), 'utf8');
const navigation = fs.readFileSync(path.join(root, 'content.parts', '12-navigation.js'), 'utf8');
const entry = fs.readFileSync(path.join(root, 'content.parts', '13-entry.js'), 'utf8');
const api = new Function(`${js}\nreturn { isChatWorkspacePath };`)();

function backgroundHarness({ pathname = '/a/chat/s/abc123', on = true, composer = true, shell = true, background } = {}) {
  const nodes = [];
  const body = {
    prepend(node) {
      const oldIndex = nodes.indexOf(node);
      if (oldIndex >= 0) nodes.splice(oldIndex, 1);
      nodes.unshift(node);
      node.parentElement = body;
    },
  };
  const document = {
    body,
    createElement() {
      const node = {
        id: '',
        className: '',
        tagName: 'DIV',
        parentElement: null,
        children: [],
        attrs: new Map(),
        style: {
          values: new Map(),
          setProperty(name, value) { this.values.set(name, value); },
          removeProperty(name) { this.values.delete(name); },
        },
        setAttribute(name, value) { this.attrs.set(name, value); },
        append(child) {
          child.parentElement = node;
          node.children.push(child);
        },
        querySelector(selector) {
          return selector === '.docdeep-page-background-image'
            ? node.children.find(child => child.className === 'docdeep-page-background-image') || null
            : null;
        },
        remove() {
          const index = nodes.indexOf(node);
          if (index >= 0) nodes.splice(index, 1);
          if (node.parentElement?.children) {
            const childIndex = node.parentElement.children.indexOf(node);
            if (childIndex >= 0) node.parentElement.children.splice(childIndex, 1);
          }
          node.parentElement = null;
        },
      };
      return node;
    },
    querySelectorAll(selector) {
      return selector === '#docdeep-page-background.docdeep-injected' ? nodes.slice() : [];
    },
    querySelector(selector) {
      if (selector === 'textarea') return composer ? {} : null;
      if (selector.startsWith('[class~="the-header"]')) return shell ? {} : null;
      return null;
    },
  };
  const location = { pathname };
  const chrome = { runtime: { getURL: asset => `chrome-extension://test/${asset}` } };
  const settings = { docdeep_template_background: background };
  const scoped = new Function(
    'chrome', 'document', 'location', 'INJECTED', 'isOn', 'settings',
    `${js}\nreturn { syncPageBackground, removePageBackground };`
  )(chrome, document, location, 'docdeep-injected', () => on, settings);
  return { ...scoped, document, body, nodes, location };
}

test('聊天工作区路由允许新会话与已有会话', () => {
  assert.equal(api.isChatWorkspacePath('/'), true);
  assert.equal(api.isChatWorkspacePath('/a/chat'), true);
  assert.equal(api.isChatWorkspacePath('/a/chat/s/abc123'), true);
  assert.equal(api.isChatWorkspacePath('/chat/abc123'), true);
  assert.equal(api.isChatWorkspacePath('/chat/s/abc123'), true);
});

test('非聊天、分享和不完整路由 fail-closed', () => {
  for (const value of ['/login', '/register', '/404', '/a/chat/share/abc', '/chat/share', '/a/chat/s/', null, undefined]) {
    assert.equal(api.isChatWorkspacePath(value), false, String(value));
  }
});

test('最小 DOM 夹具：首次挂载、重复同步只保留一个节点，关闭后移除', () => {
  const h = backgroundHarness();
  h.syncPageBackground();
  assert.equal(h.nodes.length, 1);
  const first = h.nodes[0];
  assert.equal(first.id, 'docdeep-page-background');
  assert.equal(first.parentElement, h.body);
  assert.equal(first.style.values.get('--docdeep-page-background-image'), 'url("chrome-extension://test/assets/backgrounds/main-background.png")');
  h.syncPageBackground();
  assert.equal(h.nodes.length, 1);
  assert.equal(h.nodes[0], first);
  h.location.pathname = '/a/chat/s/next456';
  h.syncPageBackground();
  assert.equal(h.nodes.length, 1);
  assert.equal(h.nodes[0], first);
  h.location.pathname = '/a/chat/share/abc123';
  h.syncPageBackground();
  assert.equal(h.nodes.length, 0);
  h.location.pathname = '/a/chat';
  h.syncPageBackground();
  assert.equal(h.nodes.length, 1);
  assert.notEqual(h.nodes[0], first);
  h.removePageBackground();
  assert.equal(h.nodes.length, 0);
});

test('根路径新建会话：有工作区壳层时挂载，缺少壳层时仍不挂载', () => {
  const h = backgroundHarness({ pathname: '/' });
  h.syncPageBackground();
  assert.equal(h.nodes.length, 1);

  const incomplete = backgroundHarness({ pathname: '/', shell: false });
  incomplete.syncPageBackground();
  assert.equal(incomplete.nodes.length, 0);
});

test('最小 DOM 夹具：关闭、非工作区或缺少 composer/shell 均不挂载', () => {
  for (const options of [
    { on: false },
    { pathname: '/a/chat/share/abc123' },
    { composer: false },
    { shell: false },
  ]) {
    const h = backgroundHarness(options);
    h.syncPageBackground();
    assert.equal(h.nodes.length, 0, JSON.stringify(options));
  }
});

test('自定义 data URL 覆盖内置资源，关闭背景配置时移除节点', () => {
  const custom = 'data:image/png;base64,iVBORw0KGgo=';
  const enabled = backgroundHarness({ background: { enabled: true, dataUrl: custom } });
  enabled.syncPageBackground();
  assert.equal(enabled.nodes.length, 1);
  assert.equal(enabled.nodes[0].style.values.has('--docdeep-page-background-image'), false);
  assert.equal(enabled.nodes[0].querySelector('.docdeep-page-background-image').src, custom);

  const disabled = backgroundHarness({ background: { enabled: false, dataUrl: custom } });
  disabled.syncPageBackground();
  assert.equal(disabled.nodes.length, 0);
});

test('大体积自定义 data URL 通过 img.src 承载，不写入 CSS 自定义属性', () => {
  const custom = `data:image/png;base64,${'A'.repeat(2 * 1024 * 1024)}`;
  const h = backgroundHarness({ background: { enabled: true, dataUrl: custom } });
  h.syncPageBackground();
  assert.equal(h.nodes[0].querySelector('.docdeep-page-background-image').src, custom);
  assert.equal(h.nodes[0].style.values.has('--docdeep-page-background-image'), false);
});

test('背景 JS 具备单节点、资源 URL、启停和 SPA 同步链路', () => {
  assert.match(js, /PAGE_BACKGROUND_ID = 'docdeep-page-background'/);
  assert.match(js, /chrome\.runtime\.getURL\(PAGE_BACKGROUND_ASSET\)/);
  assert.match(js, /preview\.src = url/);
  assert.match(js, /querySelectorAll\('#' \+ PAGE_BACKGROUND_ID \+ '\.' \+ INJECTED\)/);
  assert.match(js, /nodes\.forEach\(node => node\.remove\(\)/);
  assert.match(js, /body\.prepend\(background\)/);
  assert.match(js, /!isOn\(\) \|\| !pageBackgroundConfig\(\)\.enabled \|\| !isChatWorkspace\(\)/);
  assert.match(runtime, /syncPageBackground\(\);/);
  assert.match(runtime, /removePageBackground\(\);/);
  assert.match(navigation, /if \(!isOn\(\)\) return;\s*syncPageBackground\(\);/);
  assert.match(runtime, /docdeep_template_background/);
  assert.match(entry, /docdeep_template_background/);
});

test('CSS 满足固定、覆盖、居中、不平铺、穿透和区域1透明化要求', () => {
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /inset:\s*0/);
  assert.match(css, /z-index:\s*-1/);
  assert.match(css, /pointer-events:\s*none/);
  assert.match(css, /background-size:\s*cover/);
  assert.match(css, /background-position:\s*center center/);
  assert.match(css, /background-repeat:\s*no-repeat/);
  assert.match(css, /docdeep-page-background-image/);
  assert.match(css, /opacity:\s*\.40/);
  assert.match(css, /data-docsurface="page"/);
  assert.match(css, /rgba\(248, 247, 244, \.80\)/);
  assert.match(css, /rgba\(21, 22, 26, \.84\)/);
  assert.match(css, /data-docshell="header"/);
  assert.match(css, /data-docshell="header"[\s\S]*?background-color:\s*transparent\s*!important/);
  assert.equal((css.match(/background-color:\s*transparent\s*!important/g) || []).length, 3);
  assert.match(css, /@media print/);
  assert.match(css, /#docdeep-page-background \{ display: none !important; \}/);
});

test('Manifest 只暴露指定 PNG 给 DeepSeek 页面，未增加无关 host 权限', () => {
  const resources = manifest.web_accessible_resources || [];
  assert.deepEqual(resources, [{
    resources: ['assets/backgrounds/main-background.png'],
    matches: ['https://chat.deepseek.com/*'],
  }]);
  assert.deepEqual(manifest.host_permissions, ['https://chat.deepseek.com/*']);
  const jsList = manifest.content_scripts[0].js;
  const cssList = manifest.content_scripts[0].css;
  assert.ok(jsList.includes('content.parts/12-page-background.js'));
  assert.ok(cssList.includes('content.parts/10-page-background.css'));
  const assetPath = path.join(root, 'assets', 'backgrounds', 'main-background.png');
  const asset = fs.readFileSync(assetPath);
  assert.equal(asset.toString('ascii', 1, 4), 'PNG');
  assert.equal(asset.readUInt32BE(16), 1920);
  assert.equal(asset.readUInt32BE(20), 1080);
});
