# Phase 6 完成报告（原生输入框上下文 Markdown 格式工具栏）

## 一、阶段目标回顾

在不替换、移动或重建 DeepSeek 原生 `textarea`、`form`、发送按钮的前提下，在 popup【辅助功能】提供持久化开关，并实现仅在原生 textarea 存在非空选区时出现的 ChatGPT 风格 Markdown 浮动工具栏。第一阶段只编辑 Markdown 文本，不实现 contenteditable/WYSIWYG。

修改前实际基线：Git `main` 工作区干净，最新提交为 `c9571b0`，源码版本为 `0.3.16`。`AGENTS.md` 与规划文档中的部分版本记录已滞后，本报告以源码和本轮命令结果为准。

## 二、已完成任务

- Task 1：先建立工单和源码调用链基线，新增 `docs/工单计划/Phase-6.md`。
- Task 2：完成 Markdown 纯函数、textarea 选区/输入事件处理、仅非空选区显示的浮动工具栏、选区附近定位、快捷键和关闭清理。
- Task 3：完成 Node 语法、纯函数、快捷键、上下文可见性/DOM 夹具、CSS、版本和协议边界测试。
- Task 4：完成代码级回归核对；真实 DeepSeek Edge 窗口因调试器不可接管，保留为用户实机验收项。

## 三、实际修改内容

- `content.js:652`：新增 `formatMarkdownValue`，支持加粗、斜体、文本、标题1/2/3、编号列表、项目符号列表；支持无选区、有选区、多行、中文、前缀清理和同类重复切换。
- `content.js:840`：新增 `applyMarkdownToTextarea`，使用当前原生 textarea 的选区，优先调用 `setRangeText(..., 'preserve')`，派发冒泡 `input` 事件，再恢复焦点、selection range 和方向。
- `content.js:862`：新增 Ctrl/Cmd+B、Ctrl/Cmd+I、Ctrl/Cmd+Alt+0/1/2/3 映射；跳过 `isComposing` 和 keyCode 229，不触碰 Enter/Shift+Enter。
- `content.js:882`、`content.js:904`、`content.js:992`：新增可摘除的 `#docdeep-formatbar`，包含 B/I 和六个文本类型选项；默认 `hidden`，仅读取原生 textarea 的非空 `selectionStart/selectionEnd` 后显示；按选区所在行的估算几何位置 fixed 定位，优先上方并做视口钳制，不进入 form 布局；异步挂载/节点替换时重绑。
- `content.js`：新增 textarea `select/keyup/mouseup/click/input/compositionend`、document `selectionchange` 和页面 `pointerdown` 监听；选区收缩、输入、页面点击、失焦、路由切换和扩展关闭时隐藏/清理；点击 B/I/select 前保存选区，工具栏临时取得焦点时不提前丢选区。
- `content.js` 关闭路径：`setOn(false)` 调用 `removeFormattingToolbar()`，解除 textarea 监听并移除工具栏。
- `content.css`：新增 ChatGPT 风格深色圆角浮动面板、按钮/select、焦点、窄屏和打印隐藏规则；新增规则均以 `html[data-docdeep="on"]` 开头。
- `popup.js`、`popup.html`：在【辅助功能】增加 `docdeep_format` 开关；按 `chrome.storage.local` 持久化，使用既有 `DOCDEEP_SETTINGS` 同步内容脚本，诊断和设置导出包含该键。
- `manifest.json`、`popup.js`、`popup.html`、`content.js`：版本同步为 `0.3.18`，未改权限/host。
- `docs/功能扩展规划.md`：同步功能 13 / Phase-6 的修订需求、技术方向、状态和完成记录。

## 四、新增文件

- `docs/工单计划/Phase-6.md`
- `docs/完成报告/Phase-6-完成报告.md`

## 五、修改文件

- `content.js`
- `content.css`
- `manifest.json`
- `popup.js`
- `popup.html`
- `docs/功能扩展规划.md`

未删除文件；未修改 `background.js`、权限和消息类型；新增设置键 `docdeep_format` 属于本轮明确范围。

## 六、关键实现说明

1. inline 操作直接作用于 `[selectionStart, selectionEnd)`；有选区时包裹/解除包裹，无选区时插入成对标记并把光标放在标记中间。
2. 标题和列表按选区覆盖的完整行处理：`# `、`## `、`### `、`1. `、`- `；重复同类操作可移除前缀，文本类型会清理标题/列表前缀。
3. 每次改写只使用原生 textarea 的 `setRangeText` 或 value 兜底，随后派发 `InputEvent('input')`；没有代理发送请求、`fetch`、私有 API 或 contenteditable。
4. 工具栏节点及其控件均带 `docdeep-injected` 或 `#docdeep-formatbar`；工具栏不作为 form 子节点，默认隐藏且不改变原生表单布局和提交结构。
5. textarea 监听只用于保存选区和处理明确的格式快捷键；IME composing/229 直接放行，Enter/Shift+Enter、粘贴、附件和草稿路径未新增拦截。

## 七、测试结果

- `node --check content.js`：退出码 0。
- `node --check popup.js`：退出码 0。
- `node --check background.js`：退出码 0。
- 纯函数行为测试：9 项通过；覆盖 inline、无选区、多行、中文、标题/列表、前缀清理、非法范围和重复加粗回退。
- 快捷键/静态测试：22 项通过；覆盖六个快捷键、composing/229 跳过、原生 selection API、非空选区守卫、隐藏状态、选区附近定位、页面清理和无网络拦截。
- DOM/event 夹具：2 次应用通过，确认 `setRangeText` 路径、冒泡 input、焦点、光标/选区恢复。
- DOM 上下文工具栏夹具：控件、默认隐藏、非空选区显示、选区收缩隐藏、页面指针隐藏、失焦隐藏、原生节点边界和清理全部通过；确认两按钮、六选项、`type=button`、原 textarea 仍在原 form、监听可解除。
- CSS/source 静态断言：格式控件、选区 API、input 事件、IME 分支、清理路径、深色面板/响应式/打印结构通过。
- CSS 大括号平衡：通过。
- manifest JSON + 版本引用：`0.3.18` 一致，通过。
- 新增 content diff 边界：无 fetch、发送代理、submit/beforeinput 拦截，通过。
- `git diff --check`：退出码 0。

## 八、回归测试结果

代码级已确认：

- 既有 `classify()` 生命周期会创建/重绑工具栏，textarea 节点替换不会复用旧绑定。
- `setOn(false)` 会解除新增 textarea 监听并移除工具栏；根属性移除后新增 CSS 失效。
- `docdeep_format=false` 通过 popup/storage 消息立即移除工具栏；老配置缺少该键时双端 `DEFAULTS` 回落为 `true`，兼容已完成的功能默认启用状态。
- 无选区时工具栏节点即使已为异步挂载准备，也保持 `hidden`，不进入输入框布局；只有当前 textarea 有非空选区且 textarea/工具栏仍拥有焦点关系时才显示。
- 新增按钮均为 `type="button"`；没有移动、重建或修改原生 textarea、form、发送按钮。
- 既有全局快捷键仍跳过 editable target；新增格式快捷键只绑定当前 textarea。
- 没有新增权限、runtime 消息类型、后台下载、网络请求或 DeepSeek 私有接口调用；仅新增已纳入工单的 `docdeep_format` storage 设置键，并复用 `DOCDEEP_SETTINGS`。
- 既有导出、查找、大纲、侧栏、打印和版本诊断代码未被格式功能改写。

## 九、发现的问题

- 测试过程中有多次一次性 Node 断言命令因 PowerShell 外层引号/转义写法失败；修正为无嵌套引号版本后全部相关断言通过，未发现源码语法错误。
- 上下文 DOM 夹具首轮因夹具未实现原生 `remove()` 而失败；补齐夹具能力后同一场景通过，属于测试夹具缺口，不是源码失败。
- Edge 已有 DeepSeek 标签可见，但 CUA 两次接管结果分别为超时和 `Debugger unattached`，无法安全取得运行时 DOM/截图。
- 尝试用隔离 data 页检查浏览器原生 `setRangeText` 撤销基础行为时，被浏览器 URL 安全策略拒绝；未使用绕过方式。

## 十、遗留问题

以下项目未被本轮静态/夹具替代，仍需用户实机确认：

1. 工具栏在当前 DeepSeek 构建中的实际视觉位置、浅色/深色主题和窄屏显示，以及“无选区完全没有工具栏”的视觉结果。
2. 选中文字后点击 B/I/select，以及鼠标拖选、Shift+方向键、Ctrl/Cmd+A、多行、中文连续操作的真实 textarea 结果。
3. popup【辅助功能】开关写入后重新打开 popup/刷新页面的持久化状态。
4. Ctrl/Cmd 快捷键与真实中文 IME、粘贴、附件、草稿、Enter 发送、Shift+Enter 换行的交互。
5. 浏览器撤销/重做是否按预期回退格式化；源码已选择 `setRangeText`，但本轮未取得真实浏览器证据。
6. 路由切换、textarea 异步重挂、扩展开关启停后的真实页面状态。

## 十一、与原工单的差异

- 用户在原常驻工具栏交付尚未验收前修订需求；本轮仍沿用 Phase-6 工单，增加 `docdeep_format` 辅助功能持久化开关，并将显示条件收紧为仅非空选区。
- 上一轮实际源码基线为 `0.3.17`，本轮同步到 `0.3.18`；同步 `content.js`、`manifest.json`、`popup.js` 和 `popup.html` 四处版本标记。
- 工具栏选择 fixed 独立注入到 `body`，而不是插入 form 内部；这样能贴近原生 textarea，同时不改变原生 form 的布局和节点树。
- 本轮将定位锚点从 textarea 整体改为选区所在行的估算位置，优先选区上方并按视口边缘钳制；由于 textarea 原生 API 不提供选区 DOM 矩形，长行自动换行位置仍需实机观察。
- 为兼容撤销/重做路径，使用 `setRangeText` 优先实现替换；input 事件仍显式派发，真实浏览器事件/撤销语义留给实机验收。

## 十二、功能状态变化

- 原生输入框：`仅 CSS 视觉整合` → `可摘除的选区上下文 Markdown 文本格式工具栏 + 快捷键`。
- 辅助功能：新增 `docdeep_format` 持久化开关；默认开启以兼容上一轮功能，但无选区时工具栏不显示。
- 编辑模式：仍为 Markdown 源文本编辑；未引入 contenteditable/WYSIWYG。
- 原生发送/换行/粘贴/附件/草稿：代码路径保持由 DeepSeek 控制。
- 版本：`0.3.17` → `0.3.18`。

## 十三、下一阶段建议

没有自动下一阶段。请在扩展管理页点击“重新加载”本目录扩展，再刷新 DeepSeek 页面；确认页面脚本/面板为 `0.3.18` 后，按以下顺序实机验证：辅助功能开关持久化、无选区完全隐藏、鼠标/Shift+方向键/Ctrl/Cmd+A 形成选区后显示、选区附近定位、B/I、六个下拉项、多行、中文、连续格式化、撤销/重做、IME、粘贴、附件、草稿、Enter/Shift+Enter、发送消息、路由切换、开关启停、三主题和窄屏。

## 十四、等待用户验收

**状态：Phase-6 代码、静态测试和最小夹具完成，等待用户 DeepSeek 实机验收。** 未经用户明确说“验收通过/可以继续”，不进入 Phase-7。
