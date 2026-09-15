# 完成报告：Enter 发送交回站点原生链路（富文本表面）

## 一、工单

`docs/工单计划/Enter发送转发-工单.md`

## 二、变更摘要

修复「开启『选区格式工具栏』后，输入框内输入文本按 Enter 不发送」的缺陷。原因是富文本输入表面（contenteditable，挂在 `document.body` 下、位于 React 树之外）接管可视输入后，站点绑在**原生 `textarea` 自身 `onKeyDown`** 上的 Enter 发送链路再也收不到键盘事件；而扩展自建的代理链路（`nativeComposerSendButton` → `button.click()`）第一步即失败——站点 composer **没有 `<form>`**（`ta.closest('form')` 恒为 null），发送按钮**也不是 `<button>`**（是 `div[role=button].ds-button`）。

改为把 Enter 以原生键盘事件转发给原生 `textarea`，由站点自身 `onKeyDown` 决定发送 / 生成中停止 / 空内容提示；配套把写回 textarea 的赋值改走平台原型上的原生 `value` setter，使站点的 React 受控状态能真正读到扩展写入的内容。版本 `0.3.36` → `0.3.37`。

## 三、修改文件清单

| 文件 | 修改 |
|---|---|
| `content.parts/04-rich-editor.js:39-61` | 新增 `forwardEnterToNativeComposer(ta)`：构造可冒泡/可取消的 Enter `keydown` 转发给原生 textarea，按 `dispatchEvent` 返回值与 `event.defaultPrevented` 判定站点是否接管；异常/断连/构造器不可用一律返回 false 且不抛出 |
| `content.parts/04-rich-editor.js:195-208` | Enter 分支改为「转发优先 + 回退」：转发成功 → `preventDefault` 并返回；失败 → 原 `nativeComposerSendButton` 点击；再失败 → 不 `preventDefault`（保留编辑器默认换行，不吞键）。分支前置条件（`Enter && !shiftKey && !isComposing && keyCode !== 229`）未改 |
| `content.parts/03-rich-model.js:374-391` | `syncTextareaFromRich` 内新增局部 `writeTextareaValue`：优先用 `HTMLTextAreaElement.prototype` 的原生 `value` setter，取不到或抛错时回退直赋 |
| `content.parts/03-rich-model.js:402` | `ta.value = value;` → `writeTextareaValue(ta, value);` |
| `content.parts/00-runtime.js:18` | `VERSION` → `0.3.37` |
| `popup.parts/00-core.js:1,4` | 头注释与 `POPUP_VER` → `0.3.37` |
| `popup.html:304` | 徽标 → `v0.3.37` |
| `manifest.json:4` | 版本 → `0.3.37` |
| `AGENTS.md:7,9` | 项目简介的富文本发送说明改为「转发 Enter 交回站点 `onKeyDown`」并记明写值手法；版本行 → `0.3.37` |
| `tests/enter-forward.test.js` | 新增（8 例） |
| `docs/工单计划/Enter发送转发-工单.md`、`docs/完成报告/Enter发送转发-完成报告.md` | 新增 |
| `docs/known-issues.md` | 新增 `FORM-ASSUME-001`（登记未清理的 `form:has(textarea)` 失效链） |
| `docs/功能扩展规划.md` | 新增「功能 18」 |

## 四、与原计划差异

- 第一轮诊断汇报里的方案 B 只含「转发 Enter」。实施时确认**必须**同时修写值手法（追加 Task 3，白名单加入 `content.parts/03-rich-model.js`）：React 的受控值追踪挂在元素实例的 `value` setter 上，直接赋值会使随后的 `input` 事件被判定为「值未变」而不触发 `onChange`，只转发 Enter 可能让站点发空消息。该推论已在验证中实证（见第五节双实现对比）。
- **有意为之的行为变更（生成中按 Enter）**：Phase-7 曾把「生成中在富文本编辑器按 Enter」刻意实现为**安全空操作**（避免误点站点的「停止」按钮打断回答）。方案 B 转交站点语义后，该按键跟随站点原生 `textarea` 行为——站点生成中把主按钮切为「停止」，Enter 走 `onTryToSubmit` 即**停止生成**。这是对齐原生的必然结果，但确实翻转了一条既有约定，已在工单显式声明；如需恢复空操作，加一条「生成中不转发」保护即可，但那与方案 B 的立意矛盾。
- **Ctrl/Cmd+Enter 的行为对齐**：原实现在该分支点击发送按钮，转发后由站点处理（其原生分支为 `document.execCommand('insertText', false, '\n')`，即插入换行）。
- `composerButtonKind` 的「停止优先于发送」判定降级为回退路径，**保留未删**。

## 五、自测结果

- `node --check`：`content.parts/03-rich-model.js`、`content.parts/04-rich-editor.js`、`tests/enter-forward.test.js` 全通过；`manifest.json` 可解析。
- `node --test`（显式列 6 个文件，Node 22）：**46 通过 / 0 失败**（既有 38 + 新增 8）。
- `node scripts/check-line-count.js`：全部代码文件 ≤ 600 行（`content.parts/04-rich-editor.js` 315 行、`03-rich-model.js` 424 行、`popup.html` 503 行、`tests/enter-forward.test.js` 116 行）。
- 静态交叉校验 24 项 **0 fail**：四处版本 + `AGENTS.md` 一致为 `0.3.37` 且无 `0.3.36` 残留；权限 `["storage","downloads"]` 与 host 未扩大；`content_scripts` 顺序不变量成立；转发链路接线齐备（定义 / 调用 / 前置条件未改 / 回退保留 / 转发先于回退）；写值手法无残留直赋且有 `typeof` 守卫；content CSS 规则全部带 `html[data-docdeep="on"]` 前缀；`DEFAULTS` 键数仍为 10（未新增存储键）。

## 六、测试计划执行情况

### 6a 单测（`tests/enter-forward.test.js`，8 例）

从源文件按名抽取 `forwardEnterToNativeComposer`，用桩 textarea 驱动：站点接管（`dispatchEvent` 返回 false）→ true；站点接管但 `dispatchEvent` 仍返回 true → 依据 `defaultPrevented` 仍判 true；站点未接管 → false；转发事件的 `type/key/code/bubbles/cancelable/composed` 六项参数断言；`null` / 断连 / `dispatchEvent` 抛错 / `KeyboardEvent` 构造器不可用 → 一律 false 且不抛。

### 6b jsdom 行为校验（真实源码 + 真实 DOM 事件系统，20 项全绿）

**双实现对比（A 组，核心证据）** —— 把修复前的函数体照抄为旧实现一起跑：

| 实现 | 模拟 React 受控追踪下站点 `onChange` 收到次数 | DOM 值 |
|---|---|---|
| 旧（`ta.value = value`） | **0 次**（缺陷复现） | — |
| 新（原型原生 setter） | **1 次，内容「你好世界」** | 一致，且 tracker 已被 React 侧同步 |

另断言：值未变化时早退、不重复派发 `input`。脚本内置装配自检（旧实现体已剔除 `writeTextareaValue`、新实现确有该调用），防止对比退化为同实现。

**Enter 转发（B 组）**：站点根容器监听接管 → 返回 true 且提交逻辑触发 1 次；站点处于「停止」态 → 仍返回 true 且走停止分支、未误发消息；站点 IME 组合期不处理 → 返回 false（走回退，不吞键）；断连 / `null` / 站点无监听 → 返回 false。

**回退路径（C 组）**：`form + button[type=submit]` 结构下仍能定位发送按钮；存在「停止」时仍返回「发送」（保持 Phase-7 语义）；**站点真实形态（无 `form` + `div[role=button]`）下回退恒为空**——与缺陷诊断完全吻合，证明根因判断正确。

## 七、发现的问题

1. **站点 composer 的两条错误假设**（非本次引入，已登记为 `FORM-ASSUME-001`）：站点无 `<form>`（bundle 内 `"form"` 字面量计数 0）、发送按钮为 `div[role=button].ds-button`（无 `aria-label`/`data-testid`/`title`）。除本次修复的 Enter 链路外，它还让 `02-composer-rich.css`(22) + `04-shell.css`(2) + `09-responsive-print.css`(1) 共 **25 条** `form:has(textarea)` 规则线上全部失效（输入框卡片视觉、发送按钮主题色、聚焦态、打印隐藏输入区）。本次未清理（需先实测确定稳定锚点，属独立视觉缺陷链），已在工单「本次不涉及的内容」与 `known-issues.md` 登记。
2. **验证脚本自身的坑（影响验证，不影响产品）**：首轮 jsdom 行为校验中，A 组的桩 textarea 忘记 `appendChild`，`isConnected === false` 让 `syncTextareaFromRich` 直接早退——导致「旧实现 0 次 onChange」成为**假 PASS**（覆盖住 4 项真实 FAIL）。教训：双实现对比必须同时断言「旧实现确实复现缺陷」与「新实现行为正确」，并给桩元素正确的挂载状态，否则早退分支会制造假阳性。
3. 验证脚本对 `HTMLTextAreaElement` / `KeyboardEvent` 采用**参数注入**（而非依赖 Node 全局），使抽取的真实源码在 jsdom realm 中运行——本机 Node 无这两个全局，直接跑会静默落到兜底分支。

## 八、遗留事项

- 登录态真机回归（用户验收）：开启工具栏后 Enter 发送、Shift+Enter 换行、中文 IME 组合期的 Enter、生成中 Enter（行为变更项，重点确认）、Ctrl+Enter。
- `FORM-ASSUME-001` 的 CSS 清理（需新工单）。
- 若真机实测出现「发出空消息」（站点提交读到的仍是旧值），需把转发推迟到微任务；代价是本帧换行无法用 `preventDefault` 抑制。当前未实施。

## 九、影响面评估

- 仅改事件处理与写值手法；不新增/删除存储键、不改消息协议、不改 `DEFAULTS`、不改 popup UI、不动权限/host、不改导出/复制/查找/打印口径。
- 老用户存量配置：无新增键，无迁移需求。
- 可摘除原则：未新增注入节点；`setOn(false)` → `removeRichEditor()` 卸载监听并还原 textarea 的 `tabindex`，原站完整恢复。
- 性能：转发仅在用户按 Enter 时发生一次同步 `dispatchEvent`，无轮询、无额外监听；写值手法改为一次 `getOwnPropertyDescriptor` 调用（可用性在函数内短路）。
- 降级链清晰：转发失效 → 回退按钮点击 → 仍不行则保留编辑器默认换行（与修复前一致，不制造更差行为）。

## 十、版本

`0.3.37`

## 十一、回归结果

静态校验 24/24、单测 46/46、jsdom 行为校验 20/20、行数门禁、JSON 解析全绿。真机回归（Enter/IME/生成中 Enter/开关启停/格式工具栏/导出/打印）待用户重载扩展后验收。

## 十二、局限声明

- jsdom 校验能证明「扩展写入的正文能触发站点式受控 `onChange`」与「转发的 Enter 能被挂在根容器上的监听接管」，但**不能**证明真实站点 React 版本的内部批处理时序、真实 IME 行为与真实提交协议。这些必须由用户人工补测。
- 站点 bundle 证据对应 commit `e76f2210`；站点改版后其 Enter 处理若迁出 textarea 的 `onKeyDown`，转发将失效并退回回退路径（表现为「Enter 只换行」，可观测、不报错）。

## 十三、结论

工单目标（Enter 发送恢复、且不再依赖站点 `form` / `<button>` 假设）达成，等待用户验收；两项行为变更（生成中 Enter、Ctrl+Enter）需在验收时重点确认。
