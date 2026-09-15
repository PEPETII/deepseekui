# 工单：Enter 发送交回站点原生链路（富文本表面）

## 一、任务目标

修复缺陷：**开启「选区格式工具栏」后，在输入框内输入文本、按 Enter 不发送**（只在编辑区内换行）。

修复方式是方案 B：**不再由扩展猜测「发送按钮」，而是把 Enter 以原生键盘事件转发给原生 `textarea`，交回站点自身的 `onKeyDown` 语义**（发送 / 生成中停止 / 空内容提示），并配套修正写值手法，使站点受控状态能真正读到扩展写入的内容。

版本 `0.3.36` → `0.3.37`。

## 二、缺陷/需求根因

### 现象

`docdeep_format`（popup「选区格式工具栏」）开启后，输入区被扩展的 contenteditable 表面接管；用户打完字按 Enter，消息不发出，编辑区内多一个换行。

### 根因链（线上 bundle 核验，非推测）

核验对象：`https://chat.deepseek.com/` 首页引用的 `main.9199a2404f.js`（1.5 MB）与 `main.3208e09460.css`，站点 `meta[name=commit-id] = e76f2210`。

1. **该开关实际启用了富文本输入表面。** `ensureFormattingToolbar()`（`05-markdown-formatting.js:394`）在创建工具栏前先调 `ensureRichEditor(ta)`（`:401`）→ `04-rich-editor.js:235` 创建 `#docdeep-rich-editor`（contenteditable）挂在 `document.body` 下，并把原生 `textarea` 设为 `tabIndex=-1`、`pointer-events:none`、文字/光标透明（`02-composer-rich.css:96-103`）。用户的可视输入全部落在 contenteditable 上。

2. **站点原生的 Enter 发送绑在 `textarea` 自身。** bundle 内输入组件为
   `textareaDomProps.onKeyDown = e => { !Y.current && "Enter"===e.key && (e.ctrlKey || isMobile ? (e.preventDefault(), document.execCommand("insertText",!1,"\n")) : e.shiftKey || eE ? (e.shiftKey || submitHint.onTryToSubmit()) : (e.preventDefault(), eA("enter"))) }`。
   contenteditable 位于 React 树之外、且不是 textarea 的后代，**站点永远收不到它的键盘事件**——原生发送链路被彻底旁路。

3. **扩展自建的代理链路第一步必然失败。** `04-rich-editor.js:171-178` 的代理为
   `syncTextareaFromRich(...) → nativeComposerSendButton(textarea) → button.click()`。而：
   - `composerButtons(ta)`（`:29`）首句是 `ta.closest('form')`；**站点根本没有 `<form>` 元素**——bundle 内 `"form"` 字面量计数为 **0**，首页 HTML 亦无 `<form>`。→ 返回 `[]` → 按钮恒为 `null`。
   - 即便补上容器，发送按钮也**不是 `<button>`**：站点 DS Button 组件定义为 `jsxs(k || "div", { ...Q, ref: V, role: "button", className: "ds-button ds-button--…" })`，输入区主按钮为 `jsx(tx.$, { shape: "circle", icon: 发送/停止图标, disabled: s, onClick: () => { s || ("stop"===a ? onStop() : tryToSubmit("click")) } })` → 渲染为 **`div[role="button"]`**，`querySelectorAll('button')` 匹配不到。
   - 该按钮**无可用于语义判定的属性**：无 `aria-label`（全 bundle 仅 4 处 `aria-label`，与发送无关）、无 `data-testid`（字面量计数 0）、无 `title`；disabled 用类名 `ds-button--disabled` + `tabIndex=-1` 表达，不设原生 `disabled`。→ `composerButtonKind()` 恒判 `'other'`。

4. 于是 keydown 走到 `if (!button || button.disabled || ...) return;`——**既不 `preventDefault` 也不发送**，浏览器默认行为生效：在 contenteditable 内插入换行。即用户所见现象。

5. **附带缺陷（本次一并修）**：`syncTextareaFromRich()`（`03-rich-model.js:384`）用 `ta.value = value` 写值。React 的受控值追踪挂在**元素实例**的 `value` setter 上，直接赋值会同步刷新 tracker，紧随其后的 `input` 事件被 React 判定为「值未变」而不派发 `onChange` → 站点的受控 state 收不到扩展写入的内容。站点自身写值走的是 `HTMLTextAreaElement.prototype` 上的**原生 setter**（bundle 中可见），两者手法不同——这正是方案 B 必须配套修它的原因：只转发 Enter 而不修写值，站点可能读到空内容。

### 结论

「格式工具栏」只是把问题暴露出来的开关，真正的缺陷是 **`content` 侧对站点 composer 的两条错误假设**：站点有 `<form>`、发送按钮是 `<button>`。二者在方案 B 下都不再需要成立。

## 三、本次涉及的功能

- 富文本表面的 Enter 行为：由「扩展猜测发送按钮并点击」改为「**向原生 textarea 转发 Enter 键盘事件**，由站点自身 `onKeyDown` 决定发送 / 停止 / 提示」；转发未被站点接管时回退到原有的按钮点击路径，再不行则保留编辑器默认换行（不回归、不静默吞键）。
- 富文本表面写回原生 textarea 的赋值手法：改用平台原型上的原生 `value` setter，使站点受控状态可感知扩展写入的内容。

## 四、本次不涉及的内容

- 站点 composer 相关的 CSS 假设修正（`02-composer-rich.css` 22 条 + `04-shell.css` 2 条 + `09-responsive-print.css` 1 条 `form:has(textarea)` 规则在线上全部不匹配）。**本工单只登记，不修改**——它是一条独立的视觉缺陷链，涉及面与验证成本都不同，需另开工单。
- 删除 `nativeComposerSendButton` / `composerButtonKind` / `composerButtonDisabled` / `composerButtons`：方案 B 下仍作为回退路径保留，删除属破坏性改动。
- 「添加到输入框」（`07-addtobox.js`）里同样使用 `nativeComposerTextarea()` 的路径；其 `closest('form')` 恒 false 只影响取候选的顺序（有 `|| candidates[0]` 兜底），行为不需要改。
- 消息协议、存储键、`DEFAULTS`、popup UI、权限、host、导出/复制/查找/打印口径。

## 五、前置条件

- 用户已选定方案 B（2026-09-15 会话，明确指令「按方案 B 立一份工单并落地修复」）。
- 站点 bundle 证据已核验（见第二节），commit `e76f2210`。

## 六、代码影响范围（白名单）

- 允许：
  - `content.parts/04-rich-editor.js`（新增 `forwardEnterToNativeComposer`；Enter 分支改为转发优先 + 回退）
  - `content.parts/03-rich-model.js`（`syncTextareaFromRich` 内写值走原型 setter）
  - `content.parts/00-runtime.js`（仅 `VERSION`）
  - `popup.parts/00-core.js`（仅头注释与 `POPUP_VER`）
  - `popup.html`（仅版本徽标）
  - `manifest.json`（仅 `version`）
  - `AGENTS.md`（仅版本行）
  - `tests/enter-forward.test.js`（新增）
  - `docs/*`（本工单、完成报告、`known-issues.md`、`功能扩展规划.md`）
- 禁止：其余一切代码文件（尤其 `01-turns.js`、`05-markdown-formatting.js`、`07-addtobox.js`、`08-find.js`、`09-export.js`、全部 `*.css`）、`background.js`、权限/host、`DEFAULTS` 键集。

## 七、任务拆解

### Task 1 站点 Enter 转发原语（`04-rich-editor.js`）

新增 `forwardEnterToNativeComposer(ta)`：构造 `new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, composed: true })` 并 `ta.dispatchEvent(event)`。React 17+ 的合成事件监听挂在根容器上，事件从 textarea 冒泡即被其捕获并派发到该元素绑定的 `onKeyDown`。

返回 true 的判据：`dispatchEvent` 返回 false **或** `event.defaultPrevented === true`——React 的 `SyntheticEvent.preventDefault()` 会调用 `nativeEvent.preventDefault()`，故站点是否接管可从原生事件观察。任一异常（`KeyboardEvent` 不可用、dispatch 抛错、ta 断连）均返回 false，绝不抛出。

> 不设置 `keyCode/which`：宿主两者只读，bundle 内站点的判断用的是 `"Enter"===e.key`。

### Task 2 Enter 分支：转发优先 + 回退（`04-rich-editor.js`）

`bindRichEditor` 的 Enter 分支（`:171`）改为：

1. `syncTextareaFromRich(binding, readRichModel(editor))`（保留，确保 DOM 值最新）；
2. `forwardEnterToNativeComposer(textarea)` 为真 → `e.preventDefault()`，返回（站点已接管）；
3. 否则回退到原逻辑 `nativeComposerSendButton(textarea)` → 可用则 `preventDefault` + `click()`；
4. 均不可用 → 不 `preventDefault`，保留编辑器默认换行（与现状一致，不吞键）。

分支既有前置条件（`e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229`）**不改**：Shift+Enter 换行、IME 组合期间的 Enter 一律不接管。

### Task 3 写值手法对齐（`03-rich-model.js`）

`syncTextareaFromRich` 内把 `ta.value = value` 替换为局部辅助 `writeTextareaValue(ta, value)`：优先取 `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set` 并 `setter.call(ta, value)`，取不到或抛错时回退 `ta.value = value`。辅助函数定义在 `syncTextareaFromRich` **函数体内**，避免新增跨文件顶层依赖（既有 `tests/placeholder-flag.test.js` 以 `new Function` 抽取该函数，Node 下无 `HTMLTextAreaElement` 时 `typeof` 判定为假、自动走直赋分支，无需改动既有用例）。

### Task 4 版本同步与验证

四处版本 + `AGENTS.md` 版本行 → `0.3.37`；新增 `tests/enter-forward.test.js`；跑 `node --check`、全部单测（显式列文件）、`node scripts/check-line-count.js`、静态交叉校验。

## 八、测试计划

`tests/enter-forward.test.js`——从源文件按名抽取 `forwardEnterToNativeComposer`，用桩 textarea 驱动：

- 正常路径 1：`dispatchEvent` 返回 `false`（被 preventDefault）→ 返回 `true`，且断言事件参数 `type='keydown'`、`key='Enter'`、`bubbles/cancelable/composed` 全真。
- 正常路径 2：`dispatchEvent` 返回 `true` 但 `event.defaultPrevented` 为真 → 返回 `true`（覆盖「React 转发 preventDefault 后 dispatchEvent 仍返回 true」的实现差异）。
- 边界 1：`dispatchEvent` 返回 `true` 且未 preventDefault → 返回 `false`（站点未接管，应走回退）。
- 边界 2：`ta` 为 `null` / `isConnected === false` → 返回 `false`，不抛错。
- 边界 3：`dispatchEvent` 抛异常 → 返回 `false`，不抛错。
- 边界 4：`KeyboardEvent` 不可用（删除全局后恢复）→ 返回 `false`。

既有用例（`placeholder-flag.test.js` 的 6 例）必须全绿，证明 Task 3 未破坏 `syncTextareaFromRich` 语义。

## 九、回归测试范围

开关启停恢复原站、字号/主题/大纲开关、模板分区、选区格式工具栏（B/I/标题/列表）、复制全文、导出 MD/JSON（含取消）、打印样式、查找 ↑↓、侧栏过滤、收藏增删、行数门禁、全部单测。

专项回归（Enter 语义，需真机）：普通 `Enter` 发送、`Shift+Enter` 换行、中文 IME 组合期 Enter 不上屏/不发送、生成中 Enter（见「与原计划差异」）、空内容 Enter、Ctrl+Enter。

## 十、完成定义与验收条件

- 白名单 diff 可 Review；检查全绿；四处版本 + 徽标 + `AGENTS.md` 一致为 `0.3.37`；新增单测与既有单测全绿；汇报后停止等待用户验收。
- **真机验收口径**：开启「选区格式工具栏」后，输入框打字 + Enter 能发出消息；且关闭该开关时原生 Enter 行为不变。

## 与原计划差异

- 原工单计划（第一轮诊断汇报）提出的方案 B 仅为「转发 Enter」。实施时确认**必须**同时修 `syncTextareaFromRich` 的写值手法：React 的受控值追踪会因实例 setter 被调用而认为「值未变」，只转发 Enter 可能让站点读不到内容而发空消息。故追加 Task 3，白名单相应加入 `content.parts/03-rich-model.js`。
- **有意为之的行为变更（生成中按 Enter）**：Phase-7 曾把「生成中在富文本编辑器按 Enter」刻意实现为**安全空操作**（避免误点站点的「停止」按钮打断回答，见 `docs/完成报告/Phase-7-完成报告.md`）。方案 B 转交站点语义后，该按键将**跟随站点原生 `textarea` 的行为**（站点在生成中把主按钮切为「停止」，Enter 走 `onTryToSubmit` → 停止生成）。这是「与原生对齐」的必然结果，但确实翻转了一条既有约定，故在此显式声明。若不接受，可加一条「生成中不转发」的保护，但那等于恢复扩展自建语义、与方案 B 的立意矛盾。
- **Ctrl/Cmd+Enter 的行为对齐**：原实现在该分支会点击发送按钮；转发后由站点处理（其原生分支为 `document.execCommand('insertText', false, '\n')`，即插入换行）。同为对齐原生，一并登记。
- `composerButtonKind` 的「停止优先于发送」判定在方案 B 下退居回退路径，**保留不删**。

## 风险与待实测项

- **时序风险（低）**：站点提交读的是 React 闭包/ref 中的值。扩展在每次 `input` 时都会 `syncTextareaFromRich`，故用户按 Enter 前站点状态已同步；keydown 内那次同步只是兜底。若实测出现「发出空消息」，说明仍需把转发推迟到微任务（代价是本帧换行无法用 `preventDefault` 抑制）——留作实测分支。
- **事件可见性**：转发的 keydown 会冒泡到 `document`，理论上站点的全局快捷键监听也可感知。扩展自身的 `12-navigation.js:358` 与 `11-outline.js:121` 监听均有 `isEditableTarget(e.target)` 守卫（textarea 命中）→ 已确认不受影响。
- **不设 keyCode 的假设**：站点用 `e.key` 判断 Enter（已核验）。若站点将来改用 `keyCode`，转发会静默失效——此时表现为「Enter 只换行」，属可观测退化，不会报错。
- **站点改版**：若站点把 Enter 处理从 textarea 的 `onKeyDown` 迁到上层容器或改为受控 command 模式，转发路径失效 → 落到回退（按钮点击，本就在线上失效）→ 退化为当前现象。转发链路对站点结构的依赖**比按钮查找更浅**（只依赖「textarea 仍在 React 树内且其 onKeyDown 仍绑定」）。
- **未实测项**：登录态真机的 IME 组合、生成中 Enter、Ctrl+Enter 三种按键的转发表现，需用户重载扩展后验收。
