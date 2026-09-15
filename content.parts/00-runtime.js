'use strict';
/* deepseek ui v0.3 — content 内容脚本源文件（manifest content_scripts 按序直接加载，本文件必须最先）
 * 原则: 只打标 + 注入可摘除 UI, 不移动 textarea/form/发送按钮,
 * 不读 token/cookie, 不调私有 API, 不改 fetch。
 * WYSIWYG 是明确例外：textarea 仍保留在原 form 中，但可视输入由本地表面代理并同步回写。
 * 所有注入节点带 .docdeep-injected, 关闭时完整摘除即恢复原站。
 * 同目录各 .js 共享 isolated world 顶层作用域，等价于原先的单 IIFE；缩进保留原 2 空格层级。
 */
  const ATTR = 'data-docdeep';
  const THEME_ATTR = 'data-doctheme';
  // 思考正文隐藏开关的 <html> 属性(与主题同层, setOn(false) 一并摘除即恢复原站)
  const HIDE_THINK_ATTR = 'data-doc-hidethink';
  const INJECTED = 'docdeep-injected';
  const TURN_SEL = '.ds-message, [data-message-id]';
  const AI_SEL = '.ds-markdown.ds-assistant-message-main-content, .ds-assistant-message-main-content';
  const THINK_SEL = '.ds-thinking, [class*="ds-thinking"], [data-thinking]';
  const USER_COLLAPSE_LEN = 420;
  const VERSION = '0.3.37';
  const DEFAULTS = { docdeep_enabled: true, docdeep_width: 880, docdeep_font: 17, docdeep_theme: 'mi', docdeep_outline: true, docdeep_keys: true, docdeep_hide_native: false, docdeep_format: true, docdeep_addtobox: true, docdeep_hide_think: true };

  let lastUrl = location.href;
  let scheduled = false;
  let outlineScheduled = false;
  let spyScheduled = false;
  let olReg = []; // 大纲 scrollspy 注册表: 仅引用注入按钮与目标, 不碰原文
  let lastTurnOrder = [];
  let outlineDirty = true;
  // ---- 虚拟列表稳定层: 跨滚动累积“完整会话”认知, 不只信当前挂载 DOM ----
  // qOrder: 用户提问 key 自上而下(逻辑顺序)的最佳已知全集; qInfo: key -> { text }
  // liveElByKey: 当前已挂载 key -> element(每轮 classify 重建, 仅用于定位/高亮)
  let qOrder = [];
  let qInfo = new Map();
  let liveElByKey = new Map();
  let outlineSearchToken = 0;
  // ---- 原生目录只读缓存: DeepSeek 右侧自带对话目录(如当前构建的 div._6ffc3c9) ----
  // 哈希类名随构建变化, 故只作多策略探测之一, 结论仅用于核对计数/顺序, 不作为唯一真相。
  let nativeOutlineCache = { at: 0, data: null };
  let settings = { ...DEFAULTS };
  let findState = { open: false, keyword: '', results: [], index: -1, marks: [] };
  // 文字级高亮: 优先 CSS Custom Highlight API(不改 DOM), 不可用时回退为可逆 <mark> 包裹。
  // results 为具体文字匹配数组 [{ turn, range }], index 指向当前匹配(非整条消息)。
  const FIND_HL = 'docdeep-find';
  const FIND_HL_ACTIVE = 'docdeep-find-active';
  const FIND_MARK_CLASS = 'docdeep-find-mark';
  const FIND_MARK_ACTIVE = 'doc-find-active';
  const FIND_MAX = 1000;
  let exportState = null;
  let outlineComplete = null; // Phase-2 一键补全独立令牌(禁止复用 exportState 对象)
  // Phase-3 选择性导出: null=未触碰=全量, Set=已触碰选中集(内存态,不落盘,URL切换清空)
  let selectedQKeys = null;
  // 富文本编辑表面：原生 textarea 保留为 Markdown 发送底层，编辑器本体使用本地模型。
  let formatBinding = null;
  let formatSelection = null;
  let formatToolbarPositionScheduled = false;
  let richBinding = null;
  let richSelection = null;
  let richEditorPositionScheduled = false;
  const RICH_SOURCE_ATTR = 'data-docdeep-rich-source';
  const RICH_EDITOR_ID = 'docdeep-rich-editor';

  const isOn = () => document.documentElement.getAttribute(ATTR) === 'on';

  // 思考正文隐藏开关(见 docs/工单计划/隐藏思考正文-工单.md): 与主题/字号同层写 <html> 属性,
  // 由 01-reading.css 单点控制; 关闭或 setOn(false) 移除属性即恢复原站显示。
  function applyHideThink() {
    const root = document.documentElement;
    if (settings.docdeep_hide_think === false) root.removeAttribute(HIDE_THINK_ATTR);
    else root.setAttribute(HIDE_THINK_ATTR, 'on');
  }

  function applySettings(s) {
    const previousHideNative = settings.docdeep_hide_native === true;
    settings = { ...DEFAULTS, ...s };
    const hideNativeChanged = previousHideNative !== (settings.docdeep_hide_native === true);
    if (hideNativeChanged) {
      // 隐藏开关切换时不要复用“目录尚未挂载”的负缓存, 立即重探测。
      nativeOutlineCache = { at: 0, data: null };
    }
    // PAPER-WIDTH-001(见 docs/known-issues.md): 纸宽功能挂起，冻结为默认值，忽略存量
    settings.docdeep_width = 880;
    if (!isOn()) return;
    const root = document.documentElement;
    root.style.setProperty('--doc-paper-w', '880px');
    root.style.setProperty('--doc-font', settings.docdeep_font + 'px');
    root.setAttribute(THEME_ATTR, settings.docdeep_theme);
    root.dataset.docdeepVer = VERSION;
    applyNativeNavHide(hideNativeChanged);
    applyHideThink();
    if (settings.docdeep_format === false) removeFormattingToolbar();
    if (settings.docdeep_addtobox === false) removeAddToBoxButton();
  }

  function setOn(on) {
    const root = document.documentElement;
    if (on) {
      root.setAttribute(ATTR, 'on');
      root.style.setProperty('--doc-paper-w', '880px');
      root.style.setProperty('--doc-font', settings.docdeep_font + 'px');
      root.setAttribute(THEME_ATTR, settings.docdeep_theme);
      root.dataset.docdeepVer = VERSION;
      applyHideThink();
    } else {
      root.removeAttribute(ATTR);
      root.removeAttribute(THEME_ATTR);
      root.removeAttribute(HIDE_THINK_ATTR);
      delete root.dataset.docdeepVer;
      root.style.removeProperty('--doc-paper-w');
      root.style.removeProperty('--doc-font');
      removeFormattingToolbar();
      removeAddToBoxButton();
      document.querySelectorAll('.' + INJECTED).forEach(n => n.remove());
      document.querySelectorAll('[data-docturn]').forEach(n => n.removeAttribute('data-docturn'));
      document.querySelectorAll('[data-doc-think-done]').forEach(n => n.removeAttribute('data-doc-think-done'));
      document.querySelectorAll('[data-docrole], [data-docfp]').forEach(n => {
        n.removeAttribute('data-docrole');
        n.removeAttribute('data-docfp');
      });
      document.querySelectorAll('[data-docshell]').forEach(n => n.removeAttribute('data-docshell'));
      document.querySelectorAll('[data-docnavhide]').forEach(n => n.removeAttribute('data-docnavhide'));
      nativeOutlineCache = { at: 0, data: null };
      shellCache = { at: 0, header: null, side: null };
      document.querySelectorAll('.doc-user-collapsed, .doc-think-collapsed').forEach(n => {
        n.classList.remove('doc-user-collapsed', 'doc-think-collapsed');
      });
      try { clearFindHighlights(); } catch {}
      document.querySelectorAll('textarea[data-doc-ph]').forEach(ta => {
        ta.placeholder = ta.dataset.docOriginalPlaceholder || '';
        delete ta.dataset.docOriginalPlaceholder;
        delete ta.dataset.docPh;
      });
      findState = { open: false, keyword: '', results: [], index: -1, marks: [] };
      olReg = [];
      lastTurnOrder = [];
      outlineDirty = true;
      qOrder = [];
      qInfo = new Map();
      liveElByKey = new Map();
      // Phase-3: 选中态与 qOrder 同命,关闭即清空,重开为全量
      selectedQKeys = null;
      outlineSearchToken++;
      exportState?.cancel?.();
      exportState = null;
      // Phase-2: 补全令牌取消 + 帮助外部点击监听摘除(帮助节点随 .docdeep-injected 自动摘除)
      if (outlineComplete) outlineComplete.cancelled = true;
      outlineComplete = null;
      document.removeEventListener('mousedown', keysHelpOutside, true);
    }
  }
