# Phase 6 工单计划（原生输入框上下文 Markdown 格式工具栏）

## 一、阶段目标

在 DeepSeek 网页版原生消息 `textarea` 上方增加可摘除的上下文 Markdown 编辑工具栏，并在 popup 的【辅助功能】中提供持久化开关。开关开启后功能保持启用，但工具栏只在原生 textarea 存在非空选区（`selectionStart !== selectionEnd`）时浮动出现；没有选区时不显示且不占输入框空间。第一阶段只编辑 textarea 文本，不实现 contenteditable/WYSIWYG 富文本。

## 二、本阶段涉及的内容

- 基于原生 `textarea.selectionStart/selectionEnd` 读取选区，支持无选区、有选区、中文、多行和连续格式化；无选区时保留快捷键的 Markdown 插入能力但不显示浮动工具栏。
- 注入独立的上下文浮动工具栏：仅非空选区显示，优先位于选区上方，接近视口边缘时自动钳制；包含加粗、斜体、文本/标题 1-3、编号列表、项目符号列表。
- 工具栏采用 ChatGPT 风格深色圆角面板，并具备可访问名称、焦点样式、窄屏和打印隐藏规则；不参与原生输入框布局。
- 支持 Ctrl/Cmd+B、Ctrl/Cmd+I、Ctrl/Cmd+Alt+0/1/2/3；仅在扩展开启且未处于 IME composing 时处理。
- 修改后触发冒泡 `input` 事件，恢复原生 textarea 焦点、选区方向及光标/选区。
- 通过现有 `classify()` 生命周期处理 textarea 异步挂载、路由切换、节点替换与工具栏重挂；选区收缩、失焦、页面点击和扩展开关关闭时隐藏/清理。
- 在【辅助功能】中增加 `docdeep_format` 持久化开关；老用户无该键时按兼容默认值开启。
- 版本从本轮已实现基线 `0.3.17` 同步到 `0.3.18`。

## 三、本阶段不处理的内容

- 不替换、移动、重建或代理 DeepSeek 原生 `textarea`、`form`、发送按钮；不改 `type`、Enter/Shift+Enter、粘贴、附件、草稿或发送协议。
- 不调用 `document.execCommand`，不改 `contenteditable`，不渲染所见即所得富文本。
- 不修改 `fetch`、私有 API、Token/Cookie、权限、消息类型和后台下载逻辑；仅按本轮需求新增 `docdeep_format` 设置键。
- 不新增除 `docdeep_format` 外的设置、权限或消息；`docdeep_format` 只控制格式工具栏功能是否启用，不改变 `docdeep_enabled`、`docdeep_keys` 既有语义。
- 不依赖单一 DeepSeek 哈希 class，不改正文、大纲、侧栏、导出和查找逻辑。

## 四、前置条件

- 已读取 `AGENTS.md`、`docs/known-issues.md` 中 `PAPER-WIDTH-001`、`OUTLINE-ORDER-001`、`NATIVE-OUTLINE-001` 及现有规划。
- 已确认实际 Git 工作区在 `main` 分支且修改前干净，源码版本为 `0.3.16`；旧文档中的版本记录存在滞后，以源码和当前基线为准。
- 已确认 `classify()` 每轮调用 `ensureTools()`，`setOn(false)` 会移除 `.docdeep-injected` 并恢复 textarea placeholder；新增绑定必须补充解除监听。
- 已确认当前 `content.css` 的新增规则必须以 `html[data-docdeep="on"]` 开头，且打印段独立维护。

## 五、代码影响范围（白名单）

- `content.js`：新增 Markdown 纯函数、原生 textarea 选区/输入事件处理、格式工具栏创建与生命周期清理、快捷键绑定和定位。
- `content.css`：新增格式工具栏布局、按钮、下拉、焦点、深色面板、窄屏和打印隐藏规则；不改变原生节点布局规则。
- `manifest.json`：仅同步版本号至 `0.3.18`，不改权限/host。
- `popup.js`、`popup.html`：增加【辅助功能】中的 `docdeep_format` 开关、持久化读写和诊断字段，并同步可见版本号至 `0.3.18`。
- `docs/功能扩展规划.md`：追加 Phase-6/功能 13 状态与真实完成记录。
- `docs/完成报告/Phase-6-完成报告.md`：实现和验证完成后新建，禁止提前创建空报告。

## 六、任务拆解

### Task 1 工单与基线（主代理）

1. 记录版本、Git 状态、相关源码调用链和现有输入框约束。
2. 明确不改原生节点、不扩权限、不改发送链路的边界。
3. 将用户修订纳入本 Phase：工具栏从常驻式改为仅非空选区显示，增加 popup 持久化开关。

### Task 2 实现（主代理串行）

1. 实现纯 Markdown 变换：inline 加粗/斜体；文本、标题、编号列表、项目符号列表；同类重复操作可回退。
2. 实现无选区、有选区、多行选区和中文文本的选区映射。
3. 接入 native textarea，派发冒泡 `input`，恢复焦点、选区和 selectionDirection。
4. 注入独立上下文浮动工具栏，默认隐藏；所有控件 `type="button"` 或原生 `select`，不将原生 textarea/form/发送按钮替换或移动。
5. 监听选区、失焦和页面点击：仅 `selectionStart !== selectionEnd` 显示，选区收缩、点击其他位置、失焦、路由切换和 `setOn(false)` 时隐藏/完整清理。
6. 接入 Ctrl/Cmd 快捷键，跳过 `event.isComposing`/229 IME 状态与未处理按键。
7. 在 popup【辅助功能】增加 `docdeep_format` 开关，使用 `chrome.storage.local` 持久化并通过既有 `DOCDEEP_SETTINGS` 消息同步页面。
8. 同步版本至 `0.3.18`。

### Task 3 测试（主代理自测）

- Node 纯函数测试：无选区、有选区、多行、中文、连续格式化、标题/列表切换、边界位置和非法选区钳制。
- Node 静态断言：四处版本一致、辅助功能开关和默认值、控件/快捷键/selection API/input 事件/清理代码存在、无新增权限/发送拦截/fetch。
- `node --check`：`content.js`、`popup.js`、`background.js`。
- CSS 结构断言：所有新增格式规则有 `html[data-docdeep="on"]` 前缀，深色圆角面板、焦点、窄屏和打印隐藏均存在。

### Task 4 回归（主代理只读核对）

- 开关启停与工具栏摘除；路由切换/textarea 重挂不重复注入。
- 辅助功能开关持久化：关闭后不显示，重新打开 popup/页面后状态保持；开关开启但无选区时仍完全隐藏。
- 重点可见性矩阵：无选区完全无工具栏；鼠标拖选、Shift+方向键、Ctrl/Cmd+A 形成非空选区时显示；选区收缩或失焦立即隐藏。
- 浮动定位：优先选区上方，靠近视口边缘时钳制，不改变 textarea/form 布局。
- Enter 发送、Shift+Enter 换行、粘贴、附件、草稿和原生快捷键保持源码调用链不变。
- 现有工具条、查找、大纲、复制、导出、打印、主题和诊断版本路径不被改动。
- 明确浏览器实机仍需用户在当前 DeepSeek 页面重新加载扩展并刷新页面验收；静态/夹具测试不得冒充真实站点验证。

## 七、测试计划

- `node --check content.js`、`node --check popup.js`、`node --check background.js`。
- 纯函数行为测试覆盖：`bold/italic/text/h1/h2/h3/ol/ul`，空文本/无选区/中文/多行/连续操作/非法范围。
- 版本、manifest JSON、CSS 前缀、注入节点 class、`selectionStart/selectionEnd`、`dispatchEvent(input)`、IME 跳过和清理路径静态断言。
- DOM 最小夹具走读：工具栏按钮与 select 可创建、原生 textarea 保持同一节点、关闭后注入节点/绑定清理。

## 八、回归测试范围

扩展开关启停恢复原站、输入框字号/主题、原生发送/换行、中文 IME、粘贴/附件/草稿、撤销/重做、页面路由切换、工具栏重复注入防护、查找/大纲/复制/导出/打印、流式正文无重复工具栏、现有版本诊断一致性。

## 九、完成定义 Definition of Done

- 辅助功能开关可持久化；开启后无选区完全不显示工具栏，存在非空选区时具备规定的 2 个 inline 操作和 6 个文本类型选项，快捷键全部可定位到对应变换。
- 工具栏位于选区附近且不占用原生输入框布局，页面点击、选区收缩、失焦、路由切换和扩展关闭均能隐藏/清理。
- 所有文本变换只通过原生 textarea 的 `selectionStart/selectionEnd` 及 value 完成，修改后有冒泡 input 事件且焦点/选区可恢复。
- 选区/多行/中文/连续格式化/IME/撤销重做等代码级边界有实际测试证据。
- 原生 textarea、form、发送按钮及发送/换行链路没有被替换、移动、重建或监听拦截。
- ChatGPT 风格深色圆角面板、焦点、窄屏和打印隐藏规则完成；关闭扩展可完整移除注入 UI 和新增监听。
- 白名单 diff 可审查；测试失败或发现原生行为风险时阻断完成并写入报告。
- 路线图和完成报告基于真实 diff、命令结果和实机限制更新。

## 十、交付与验收条件

- 顺序固定为：本工单 → 实现 → 测试 → 回归 → 完成报告 → 汇报。
- 不创建或进入 Phase-7；完成汇报后停止，等待用户明确验收。
- 用户验收前不把静态测试表述为 DeepSeek 实机 UI 已通过。用户需在扩展管理页重新加载目录，再刷新 `https://chat.deepseek.com/`，依次验证辅助功能开关持久化、无选区隐藏、鼠标/键盘选区显示、选区附近定位、格式化、发送/换行、IME、撤销/重做、路由切换和开关关闭。
