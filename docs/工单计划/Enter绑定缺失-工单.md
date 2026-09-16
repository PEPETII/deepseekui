# 工单：富文本表面 keydown 监听缺失导致 Enter 不发送（v0.3.39）

## 一、任务目标

修复缺陷：**开启「选区格式工具栏」后，在输入框内输入文本、按 Enter 只换行、不发送**。

版本 `0.3.38` → `0.3.39`。

## 二、缺陷/需求根因

### 现象

`docdeep_format`（popup「选区格式工具栏」）开启后，输入区被扩展的 contenteditable 表面接管；用户打完字按 Enter，消息不发出，编辑区内多一个换行。

### 根因链

1. **接管链**：`classify()`（`12-navigation.js:293`）→ `ensureFormattingToolbar()`（`05-markdown-formatting.js:394`，`:401` 先调 `ensureRichEditor`）→ `04-rich-editor.js:265` 创建 `#docdeep-rich-editor`（contenteditable，挂 `document.body` 下），原生 `textarea` 设 `tabIndex=-1` + `pointer-events:none`/透明（`02-composer-rich.css:96-103`）。可视输入全部落在 contenteditable 上。
2. **站点链路被旁路**：站点 Enter 发送绑在原生 `textarea` 自身 `onKeyDown`（React 合成事件，挂根容器）。表面在 React 树外且非其后代，站点收不到它的键盘事件。
3. **扩展的转发逻辑是死代码**：`bindRichEditor` 内定义的 `keydown` handler（`:181`，含「Enter 转发优先 + 回退」分支）**从未被注册**——`events` 数组（`:245`）只有 focus/keyup/mouseup/click/beforeinput/input/compositionstart/compositionend，漏了 `['keydown', keydown]`。`forwardEnterToNativeComposer`（`:45`）定义完好、单测 8 例全绿，但线上永远走不到。
4. 于是 Enter 在 contenteditable 内走浏览器默认行为：插入换行。即用户所见现象。
5. 与 v0.3.37 诊断的区别：v0.3.37 修的是「转发函数不存在 / 按钮查找恒为空」（`FORM-ASSUME-001`），本次修的是「转发函数存在但监听没挂上」——同一症状的第二层断点。

## 三、本次涉及的功能

- 富文本表面的 Enter 恢复：`events` 数组补 `['keydown', keydown]`，转发优先 + 回退逻辑即刻生效（分支本体、前置守卫、回退路径一字不改）。
- 新增接线回归单测 `tests/enter-binding.test.js`（4 例），防止「定义了 handler 却没绑定」的静默失效重演。

## 四、本次不涉及的内容

- 转发函数本体、前置条件（`Enter && !shiftKey && !isComposing && keyCode !== 229`）、回退按钮语义、写值手法、CSS、消息协议、存储键、`DEFAULTS`、popup UI、权限/host、导出/复制/查找/打印口径。
- `FORM-ASSUME-001` 的 CSS 清理（独立视觉缺陷链，另开工单）。

## 五、前置条件

- 无。单文件一行修复 + 新增单测。

## 六、代码影响范围（白名单）

- 允许：
  - `content.parts/04-rich-editor.js`（`events` 数组加一行）
  - `content.parts/00-runtime.js`（仅 `VERSION`）
  - `popup.parts/00-core.js`（仅头注释与 `POPUP_VER`）
  - `popup.html`（仅版本徽标）
  - `manifest.json`（仅 `version`）
  - `AGENTS.md`（仅版本行）
  - `tests/enter-binding.test.js`（新增）
  - `docs/*`（本工单、完成报告、`known-issues.md`、`功能扩展规划.md`）
- 禁止：其余一切代码文件、`background.js`、权限/host、`DEFAULTS` 键集。

## 七、任务拆解

### Task 1 补绑定（`04-rich-editor.js`）

`events` 数组加 `['keydown', keydown]` 一行。挂载（`events.forEach addEventListener`）、卸载（`binding.listeners = events.map(...)` → `removeRichEditor`）自动沿用既有 bookkeeping，无需另写拆卸逻辑。

### Task 2 接线回归单测（`tests/enter-binding.test.js`，4 例）

从源文件按名抽取 `bindRichEditor` 做静态断言：

- keydown handler 定义存在；
- `events` 数组含 `['keydown', keydown]`；
- 监听经 events 数组统一挂载到 editor 且纳入卸载 bookkeeping；
- Enter 分支仍是转发优先 + 回退、前置守卫未被放宽。

### Task 3 版本同步与验证

四处版本 + `AGENTS.md` 版本行 → `0.3.39`；跑 `node --check`、全部单测（`think-collapse.test.js` 需 jsdom，本机无 node_modules 则跳过并注明）、`node scripts/check-line-count.js`（经 `line-count.test.js`）。

## 八、测试计划

见 Task 2。另沿用既有 `tests/enter-forward.test.js`（8 例）验证转发函数本体未被本次改动破坏。

## 九、回归测试范围

开关启停恢复原站、字号/主题/大纲开关、模板分区、选区格式工具栏（B/I/标题/列表）、复制全文、导出 MD/JSON（含取消）、打印样式、查找 ↑↓、侧栏过滤、收藏增删、行数门禁、全部单测。

专项回归（需真机）：普通 `Enter` 发送、`Shift+Enter` 换行、中文 IME 组合期 Enter 不上屏/不发送、生成中 Enter、空内容 Enter。

## 十、完成定义与验收条件

- 白名单 diff 可 Review；检查全绿；四处版本 + `AGENTS.md` 一致为 `0.3.39`；新增单测与既有单测全绿（jsdom 缺失项除外，需注明）；汇报后停止等待用户验收。
- **真机验收口径**：开启「选区格式工具栏」后，输入框打字 + Enter 能发出消息；且关闭该开关时原生 Enter 行为不变。

## 与原计划差异

- 无。这是 v0.3.37 转发方案的补漏，不是新方案。

## 风险与待实测项

- **风险极低**：只加一行注册，handler 本体与守卫未动；卸载路径自动复用 bookkeeping，不新增泄漏面。
- **未实测项**：登录态真机的 Enter 发送 / IME / 生成中 Enter，需用户重载扩展后验收。
