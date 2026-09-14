# 工单：Phase-7 对话队列（一次性提交多条，逐条自动发送）

## 一、任务目标

新增「对话队列」：用户一次性提交多条纯文本消息，扩展在**当前会话内**按顺序逐条发出——
上一条回答结束后自动发送下一条，直至队列清空，全程无需用户手动触发。

语义已由用户确认：**同一对话内连续追问**。后续每条消息都能看到前文上下文，不新开会话、不改路由。

默认行为约束：

- 队列**只存内存**，不落盘；浏览器重启或页面刷新后不留残迹，绝不会出现「重开浏览器后自己开始发消息」。
- 队列**只由用户显式启动**；扩展启用/禁用开关与队列相互独立。
- 只支持纯文本，不支持附件、图片、@引用。

版本同步 `0.3.24`。

## 二、本次涉及的功能

- 新增「队列」运行时：入队解析、逐条发送、生成结束判定、暂停/继续/清空。
- 新增 popup 第 5 个分区「队列」：录题（一行一条）、启动、暂停/继续、清空、进度列表。
- 新增页面内注入面板 `#docdeep-queue`（挂 `#docdeep-dock`）：运行中的实时进度与暂停/清空控制。
- 新增消息类型 `DOCDEEP_QUEUE`（popup → content）与 `DOCDEEP_QUEUE_STATE`（content → popup 广播）。
- 新增文件 `queue.js`：无 DOM、无网络的纯状态机 + 完成判定策略，Node 可单测。
- popup 分区数 4（阅读 / 模板 / 操作 / 收藏）→ 5（阅读 / 模板 / 操作 / **队列** / 收藏）。

## 三、本次不涉及的内容

- **不改发送链路本体**：不替换/移动/重建 textarea、form、发送按钮；仍以「写回原生 textarea + 派发冒泡 input + 点击原生发送按钮」为唯一发送方式，不调私有 API、不改 fetch。
- **不改路由**：不新开会话、不切 URL、不碰 `history`。
- **不新增 host 权限**、不新增网络请求、不采集 token/cookie/账号信息。
- **不新增 `chrome.storage` 键**：`DEFAULTS` 八键不变。队列为内存态（与 `selectedQKeys` 同先例）。
- **不改导出/大纲/收藏/查找/打印** 的行为与数据结构。
- `background.js`、`rich-model.js`、`docs/known-issues.md` 历史结论。

## 四、前置条件

- 用户已确认需求与语义（同会话连续追问）。
- 发送原语已在 Phase-6 WYSIWYG 中落地（`syncTextareaFromRich` + `dispatchTextareaInput` + 原生发送按钮 `click()`）。
- **风险声明**：Phase-6 的发送链路至今**未完成实机验收**（见 `docs/完成报告/Phase-6-WYSIWYG-完成报告.md`）。队列完全建立在该链路上，因此队列的第一次真机运行同时承担 Phase-6 发送链路的验收职责。

## 五、代码影响范围（白名单）

- 允许：
  - `queue.js`（新增，纯逻辑）
  - `tests/queue.test.js`（新增）
  - `content.js`（停止语义探针、turn 采样、发送原语调用、队列运行时接线、注入面板、消息处理、生命周期与互斥、`VERSION`）
  - `content.css`（`#docdeep-queue` 样式 + 三主题令牌 + 打印隐藏）
  - `popup.html`（Tab / pane / 队列样式 / 可见版本号）
  - `popup.js`（队列分区接线、`DOCDEEP_QUEUE_STATE` 监听、`POPUP_VER`）
  - `manifest.json`（`content_scripts.js` 增加 `queue.js`、版本号）
  - `AGENTS.md`、`docs/功能扩展规划.md`、`docs/完成报告/Phase-7-完成报告.md`
- 禁止：`background.js`、`rich-model.js`、`docs/known-issues.md` 历史结论、`manifest.json` 的权限与 host。

## 六、任务拆解

### Task 1 `queue.js`：纯逻辑层（已完成）

内容：常量与可调参数 `QUEUE_TUNING`；`parseQueueText`（换行分条、行首有序标记剥离、单行编号列表启发式切分、条数与单条长度上限）；`isStopLabel` / `isSendLabel`（停止与发送语义判定，供 DOM 探针复用）；`initialQueueState`；`reduceQueue(state, event)` 纯 reducer，输出 `{ state, effects }`，effects 为 `send` / `toast`；`queueStatusText`。

验收：不引用 `document`/`window`/`chrome`；`node --check` 通过；`tests/queue.test.js` 全绿。

### Task 2 `content.js`：DOM 适配与运行时（已完成）

内容：

1. `queryTurns()`：把 `classify()` 内联的「去嵌套 turn 查询」抽成单例，供 classify 与队列采样共用，保证两边看到完全相同的节点集合（行为等价重构）。
2. 停止语义探针：`nativeComposerStopButton(ta)`（form 内 label 命中停止语义的按钮）。同时**修正** `nativeComposerSendButton` 排除停止语义按钮——否则生成中富文本编辑器按 Enter 会点到「停止」而打断回答（属声明式行为修正）。
3. `sampleQueueProgress()`：返回 `{ hasStop, textLen, turnCount }`；`textLen` 取**整条 turn 的 `textContent`**（含 `.ds-think-content`），否则深度思考阶段正文不动会被误判为已完成。
4. 队列运行时：`setTimeout` 链（`POLL_MS`）、`runQueueEffect`（执行 `send`/`toast`）、`sendQueueItem`（前置校验：任务互斥 / 无输入框 / 正在生成 / 用户草稿；写入走 `richBinding` 或直接 textarea；点击原生发送）。
5. 注入面板 `#docdeep-queue`：状态行 + 条目列表（当前项高亮）+ 暂停/继续/清空。
6. 消息：`DOCDEEP_QUEUE {action: start|pause|resume|clear|get}`（带回执）；状态变化时广播 `DOCDEEP_QUEUE_STATE`。
7. 生命周期与互斥：`setOn(false)`、`classify()` 的 `urlChanged` 分支 → `ABORT`；队列运行中拒绝导出与一键补全，反之亦然。

验收：`node --check` 通过；队列不在 `isOn()` 为假时运行；关闭扩展后无遗留定时器与节点。

### Task 3 `popup.html` / `popup.js`：队列分区（已完成）

内容：新增 `data-tab="queue"` Tab 与 `data-pane="queue"` 分区；`textarea#queue-text` 录题、`#queue-start` 加入队列并开始、`#queue-pause` 暂停/继续、`#queue-clear` 清空、`#queue-state` 状态文案、`#queue-list` 进度列表；打开面板时 `{action:'get'}` 拉取一次快照，并监听 `DOCDEEP_QUEUE_STATE` 实时刷新。

验收：tab 与 pane 顺序一一对应；无悬空 id；非 DeepSeek 页面给出人话提示而不是静默失败。

### Task 4 `content.css`：面板样式（已完成）

内容：`#docdeep-queue` 系列规则，全部以 `html[data-docdeep="on"]` 开头，颜色一律走 `--dd-*` 令牌（三主题自动成立），打印段追加隐藏。

### Task 5 验证与文档（已完成）

内容：`node --check` 三 JS；`tests/queue.test.js` 与既有单测同跑；静态交叉校验（新增 id 引用、tab/pane 对齐、`queue.js` 无 DOM 引用、三处版本一致）；`docs/功能扩展规划.md` 新增功能 15 与路线图；完成报告；`AGENTS.md` 版本与架构行。

## 七、测试计划

- 正常路径：录入 3 条 → 启动 → 逐条发出、上一条答完发下一条 → 结束显示 `3/3 已完成`。
- 边界 1（解析）：空输入 / 全空白 → 0 条且不启动；单行编号列表被切分为多条；已换行的编号列表剥离行首 `1.`；超过 20 条时截断并提示跳过条数；单条超长判为跳过。
- 边界 2（前置校验）：输入框已有用户草稿 → 拒绝启动并提示，绝不覆盖；正在生成（存在停止按钮）→ 拒绝启动；导出/一键补全进行中 → 拒绝启动。
- 边界 3（生命周期）：运行时切换 URL → 队列中止并提示；关闭扩展 → 定时器停止、面板摘除、无遗留；后台标签页节流下仍能推进（阈值按采样次数而非绝对毫秒）。
- 边界 4（异常）：找不到输入框（分享页/未登录）→ 提示并中止；发送后 15 秒内无任何生成迹象 → 判 `no-start` 并暂停（不重复发送同一条）；单条超过看门狗 → 判超时并暂停。
- 纯函数单测：`parseQueueText` 的正常/空白/编号/超限/超长；`isStopLabel`/`isSendLabel` 的停止、发送、无关标签；`reduceQueue` 的全流程（启动→SENT→SAMPLE→完成→间隔→下一条→结束）、暂停/继续、`no-start` 不重发、超时、`CLEAR`/`ABORT` 幂等。

## 八、回归测试范围

开关启停恢复原站、字号/主题/模板卡、大纲与其一键补全、隐藏官网目录、选区格式工具栏与 WYSIWYG 发送（Enter **不再**点中停止按钮）、键盘导航 J/K/?、复制全文、导出 MD/JSON/HTML（含取消）、打印样式、查找 ↑↓、收藏全链路、五分区切换。

## 九、完成定义 Definition of Done

- 白名单 diff 可 Review；`node --check` 通过；新增单测与既有单测全绿。
- 三处版本 + popup 可见版本为 `0.3.24`；`manifest.json` 可解析且 `queue.js` 在 `content.js` 之前加载。
- `queue.js` 不出现 DOM/chrome 引用；`content.css` 新增规则全部以 `html[data-docdeep="on"]` 开头；打印段包含 `#docdeep-queue`。
- 无新增存储键、无新增权限、无新增网络调用。
- 规划文档可查功能 15 状态与工单/报告链接；完成报告基于真实 diff。

## 十、交付与验收条件

- 先完成代码、验证、报告，再向用户汇报。
- 汇报后停止，等待用户**实机验收**。未获明确确认前：不追加队列的高级能力（附件、多队列、断点续跑、跨会话队列），不改判定阈值以外的策略。
- 已知待实机确认项：DeepSeek 生成中「停止」按钮的可访问标签与节点位置、生成结束的稳定时延、发送频率是否触发站点风控。
