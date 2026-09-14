# Phase-7 完成报告（对话队列：一次提交多条、逐条自动发送）

## 一、阶段目标回顾

按 `docs/工单计划/Phase-7.md`：新增「对话队列」——用户一次性提交多条纯文本消息，扩展在**当前会话内**按顺序逐条发出，上一条回答结束后自动发送下一条，直至队列清空，全程无需手动触发。语义经用户确认为**同一会话内连续追问**（不新开会话、不动路由）。

硬约束：队列只存内存、只由用户显式启动、只发纯文本、不复用任何私有 API 或 fetch、不新增权限与存储键。版本同步 `0.3.24`。

## 二、已完成任务

- Task 1 `queue.js` 纯逻辑层：文本入队解析 + 发送/停止按钮语义 + 队列状态机（367 行）。
- Task 2 `content.js` DOM 适配：停止探针、turn 采样、原生发送原语调用、队列运行时、注入面板、消息处理、生命周期与互斥（队列段落 292 行）。
- Task 3 `popup.html` / `popup.js`：第 5 个分区「队列」+ 进度列表 + 页面广播监听。
- Task 4 `content.css`：注入面板样式（131 行，全部带 `html[data-docdeep="on"]` 前缀，三主题走令牌，打印隐藏）。
- Task 5 验证与文档：语法/单测/静态交叉校验/渲染冒烟 + 工单、报告、规划、AGENTS 同步。

## 三、实际修改内容

### 新增 `queue.js`（367 行，纯逻辑，无 DOM / 无网络 / 无 chrome）

- `queue.js:10-32` `QUEUE_MAX=20`、`ITEM_MAX=4000`、`TUNING`（采样间隔 600ms、开始前守卫 15s、单条看门狗 240s、条目间隔 2s、静默阈值 2 次/1200ms 与降级 6 次/4000ms）。
- `queue.js:86-114` `parseQueueText`：一行一条、空行忽略；仅当**有两条以上且所有非空行都带标记**时才统一剥离行首编号（单条绝不剥离，避免改掉用户写的内容）；条数/长度上限如实报数。
- `queue.js:63-84` `splitInlineNumbered`：单行编号列表（`1. 甲；2. 乙；3. 丙`）按连续递增编号切分，编号不连续或不足两条则不切。
- `queue.js:120-133` `classifyComposerButton` / `isDisabled`：**停止优先于发送**的按钮语义判定。
- `queue.js:171-320` `reduceQueue(state, event)`：纯 reducer，返回 `{state, effects}`，effects 仅声明 `send` / `toast`，副作用由 DOM 层执行。
- `queue.js:322-345` `queueStatusText` / `queueErrorText`：进度与人话错误文案（注入面板与 popup 共用）。

### `content.js`（队列段落 `content.js:1810-2101`）

- `content.js:18` `VERSION` → `0.3.24`。
- `content.js:61-65` 队列内存态：`QUEUE_PANEL_ID` / `queueState` / `queueTimer` / `queueSentText` / `queueLastBroadcast`。
- `content.js:139-142`（`setOn(false)` 分支）停定时器、清状态、广播 idle —— 关扩展即彻底摘除。
- `content.js:165-179` 抽出 `queryTurns()`：把 `classify()` 内联的「去嵌套 turn 查询」提为单例，队列采样与 classify 共用同一口径（`classify` 内改为 `const turns = queryTurns()`，行为等价）。
- `content.js:994-1035` 按钮探针：`composerButtonInfo` / `composerButtonKind` / `composerButtonDisabled` / `composerButtons` / `nativeComposerSendButton` / `nativeComposerStopButton`。发送按钮查找**先排除停止语义**（原实现只认 `type==='submit' || /发送|send/`，生成中会把「停止」当成发送按钮点下去）；`queue.js` 缺失时保留同语义降级分支，避免宿主脚本连带让原生 Enter 发送失效。
- `content.js:1810-1847` 队列段落头 + `queueApi()` + `isConversationUrl` / `urlChangeIsOurSend`。
- `content.js:1849-1872` `assistantTurnSample` / `sampleQueueProgress`：`textLen` 取**整条 turn 的 `textContent`**（含 `.ds-think-content`），`hasStop` 取 composer 内停止语义按钮。
- `content.js:1875-1972` `ensureQueuePanel` / `paintQueuePanel`：注入面板挂 `#docdeep-dock`、插在 `#docdeep-tools` 之前；列表按签名重建（避免每 tick 打断滚动）。
- `content.js:1974-1993` `broadcastQueue`：`DOCDEEP_QUEUE_STATE` 节流 500ms 广播；无人接收时吞掉错误。
- `content.js:1995-2035` `sendComposerText`：前置校验（未启用 / 导出或补全占用 / 无输入框 / 正在生成 / 用户草稿）→ 写回原生 textarea + `dispatchTextareaInput`（富文本表面的 input 监听据此同步编辑器）→ 写后复查按钮 → `button.click()`。
- `content.js:2037-2076` `queueDispatch`：迭代处理 effect 产生的后续事件（16 次上限），不在 effect 执行中嵌套派发；随后重绘面板、广播、按状态续停定时器。`queueTick` 每 600ms 采样一次。
- `content.js:2078-2101` `handleQueueMessage`：`start` / `pause` / `resume` / `clear` / `get`（兜底）。运行中拒绝另起一队。
- `content.js` `classify()` 的 `urlChanged` 分支：除「无会话地址 → 会话地址且队列正在等回答」这一例外，一律 `ABORT`。
- `content.js` `exportConversation` / `completeOutline` 入口各加一行队列占用守卫（互相让路）。
- `content.js` `onMessage`：新增 `DOCDEEP_QUEUE` 分支，`send(handleQueueMessage(msg))` + `return true`（popup 靠这次回执拿快照）。

### `content.css`（`content.css:889-1019`）

- 14 条 `#docdeep-queue` 规则：面板卡、状态点（running/paused/done 三态）、按钮、条目列表（`done/current/paused/pending` 四态标记与高亮）、错误行。颜色全部走 `--dd-*` 令牌，故米黄/纯白/墨色三主题自动成立。
- `content.css:1641` 打印段新增 `#docdeep-queue`。

### `popup.html` / `popup.js`

- `popup.html:351` 新增 `data-tab="queue"`，插在「操作」之后；`popup.html:485-511` 新增 `data-pane="queue"`：录题 textarea（`#queue-text`，`queue-compose` 包住）、`加入队列并开始`、暂停/清空、状态行与错误行、队列进度列表、说明文案。分区数 4 → 5。
- `popup.html:236-274` 新增样式：`.ta` / `.queue-compose[hidden]` / `.queue-state` / `.queue-error` / `.queue-list` / `.queue-item`（四态）/ `.queue-mark` / `.queue-item-text` / `.queue-empty`；顺带补 `.btn:disabled`（此前缺失，禁用按钮看起来仍可点）。
- `popup.html:342` 可见版本 → `v0.3.24`。
- `popup.js:500-590` 队列块：`queueRowState` / `queueMark`（纯函数，已进单测导出）、`renderQueue`（有队列在跑时收起录题区）、`queueAction`（区分「没开会话」与「页面没响应」）、`refreshQueue`。
- `popup.js:731-744` 按钮接线（start / pause-resume / clear）+ `chrome.runtime.onMessage` 监听 `DOCDEEP_QUEUE_STATE`。
- `popup.js:531` `load()` 追加 `refreshQueue()`，面板打开即拉一次快照。
- `popup.js:3-4` `POPUP_VER` → `0.3.24`。

### `manifest.json` / 文档

- `manifest.json:4` 版本 → `0.3.24`；`manifest.json:12` `content_scripts.js` 增加 `queue.js`（置于 `content.js` 之前）。权限与 host 逐行未动。
- `AGENTS.md`、`docs/功能扩展规划.md`：见第四节。

## 四、新增文件

- `queue.js`、`tests/queue.test.js`（25 用例）、`tests/queue-popup.test.js`（5 用例）
- `docs/工单计划/Phase-7.md`、`docs/完成报告/Phase-7-完成报告.md`（本文件）

## 五、修改文件

- `content.js`、`content.css`、`popup.html`、`popup.js`、`manifest.json`（`js` 数组 + 版本）
- `AGENTS.md`：当前版本 → `0.3.24`；架构图新增 `queue.js` 行与 `DOCDEEP_QUEUE` 消息；主要目录职责补 `queue.js`；项目简介补队列复用原生发送链路的说明。
- `docs/功能扩展规划.md`：新增「功能 15：对话队列」并更新路线图。
- 确认未改：`background.js`、`rich-model.js`、`tests/rich-model.test.js`、`tests/template.test.js`、`docs/known-issues.md`。

## 六、关键实现说明

- **最难的不是发送，是「怎么知道答完了」。** 发送原语在 Phase-6 已经存在（写回 textarea + 派发 input + 点原生发送按钮），队列只是把「用户按 Enter」换成定时器调用。真正要设计的是结束判定，最终采用三信号与门：① composer 内停止语义按钮消失；② 整条 turn 的文本静默（观察到停止按钮时 2 次采样 / 1200ms，未观察到时降级为 6 次 / 4000ms）；③ 未超单条看门狗。任一不满足就不推进。
- **采样必须取整条 turn 的 `textContent`。** 若只取回答正文（`AI_SEL`），深度思考阶段正文不动，会被判成「已静默」而提前把下一条挤进还没答完的回复里——这正是本仓 Q-INFLATE-001 记录过的 `THINK_SEL` / `AI_SEL` 结构差异。因此采样口径为整条 turn（含 `.ds-think-content`）。
- **绝不重复发送。** reducer 里 `pendingResend` 只在「确定没发出去」（`no-start`）或「还没点发送」（`phase==='send'`）时为真；回答生成中暂停再继续只恢复守候，不会重发已发出的那一条。带停止按钮的采样永远不会判定完成（`hasStop` 为真即不满足与门），所以不会出现「两条消息同时在一个回复里排队」。
- **失败一律暂停，绝不闷头往下发。** 无输入框、正在生成、用户草稿、导出占用、按钮不可用、超时，全部落到 `paused` 并给人话原因；是否继续由用户点「继续」决定。这比工单原先写的「自动重试 1 次」更保守（见第十一节）。
- **用户草稿优先于队列。** `queueSentText` 记录队列自己写进去的最后一条文本，仅当输入框内容与它相同（我方残留）才允许覆盖；用户手打的草稿会让队列暂停并提示。这是为了避免队列把用户正在写的东西冲掉。
- **URL 变化有一个必须放行的例外。** 在「新会话」页发出第一条消息时，站点通常会把地址从无会话地址变成 `/a/chat/s/<id>`——这是我们这条消息被接收的结果，不是用户换会话。若一律中止，队列在新会话里永远只能发出一条。故 `urlChangeIsOurSend()` 只放行「无会话地址 → 会话地址」且队列处于 `await`/`stream`，其余地址变化一律 `ABORT`（并把后续消息发进另一个对话是更严重的错误）。
- **判定逻辑与 DOM 适配分离。** 所有阈值与状态迁移都在 `queue.js`（无 DOM、无 chrome、Node 可测），`content.js` 只提供三个采样量与一个发送原语；effect 以声明形式返回，由 DOM 层迭代执行，避免 effect 执行中嵌套派发把状态写花。
- **队列是内存态。** 不新增存储键（`DEFAULTS` 八键不变），刷新或换会话即清空。浏览器重启后残留一个会自动发消息的队列是危险默认，故刻意不落盘。

## 七、测试结果

- `node --check`：`content.js` / `popup.js` / `queue.js` 全部通过；`manifest.json` JSON 可解析。
- 单测：`node --test tests/queue.test.js tests/queue-popup.test.js tests/rich-model.test.js tests/template.test.js` → **44/44 通过**（新增 30，既有 14 无回归）。
  - `queue.test.js` 25 例：解析（空输入/逐行/编号剥离/单条不剥离/不误伤 `1.5 倍`/单行编号切分/上限截断/超长跳过/CRLF）、按钮语义（停止优先于发送、英文 stop、type=submit、无关按钮、aria-disabled）、状态机（空队列启动不发送、重复 START 不重发、两条走完全程、间隔内不发、停止信号短阈值与降级长阈值、`hasStop` 时永不判完成、`no-start` 暂停且允许重发、生成中暂停继续不重发、超时不可重发、硬失败后可继续、CLEAR/ABORT 幂等、未知事件与脏数据不抛异常）、文案函数。
  - `queue-popup.test.js` 5 例：进度行四态映射、暂停态当前条显示、完成态全 done、脏数据不抛异常、标记符号。
- 静态交叉校验（`verify-phase7.js`，全过）：四处版本一致为 `0.3.24`；权限 `["storage","downloads"]` 与 host 未扩大；`content_scripts.js` 顺序为 `rich-model.js / queue.js / content.js`；**未新增任何存储键**；popup.js 全部 id 引用在 popup.html 中存在；`data-tab` 与 `data-pane` 一一对应为 `read / skin / act / queue / mark`；新增样式类齐全；`QUEUE_PANEL_ID === 'docdeep-queue'`；14 条面板样式规则全部以 `html[data-docdeep="on"]` 开头；打印段包含 `#docdeep-queue`；57 个 `--dd-*` 令牌引用全部有定义；`queue.js` 无 `document.`/`window.`/`chrome.`/`fetch(` 且正确挂载 `globalThis.DocDeepQueue`；`queue.js` 导出的 10 个接口名与 content.js 使用一致；popup 发出的 `start`/`pause`/`resume`/`clear` 在 content.js 均有处理分支且存在 `get` 兜底。
- 渲染冒烟（Edge headless + 夹具，`C:/Users/KING/AppData/Local/Temp/opencode/preview/`）：
  1. `queue-idle.png`：空闲态显示录题区与占位示例，状态「队列为空」，进度区给人话空状态。
  2. `queue-running.png`：运行态录题区自动收起，显示「第 2/3 条 · 回答生成中」，三条目分别为 ✓（删除线）/ ▸（赤陶高亮）/ ·。
  3. `queue-paused.png`：暂停态按钮变「继续」，状态「已暂停 · 第 3/3 条」+ 右侧错误行「这一条等待超时」。
  4. `panel-mi.png`：注入面板在页面右下角渲染正常（状态点 + 进度 + 暂停/清空 + 三态条目）。
- 局限声明：夹具是 `file://` 页面，**不能**验证真实发送、真实生成结束判定、SPA 路由、站点停止按钮的真实标签。这些必须由用户在真实 DeepSeek 页面补测（第十节列出具体步骤）。

## 八、回归测试结果

- 走读级通过：`classify()` 的 turn 去嵌套改为调用 `queryTurns()`，逻辑逐字搬移（含 `try/catch` 与嵌套判定），除节点集合来源外无行为变化；`setOn(false)` 仅新增清定时器与广播；导出与一键补全仅各加一行守卫；导出/大纲/收藏/查找/打印/模板/键盘导航的代码路径与 id 未被触碰，静态校验无悬空引用。
- 既有 14 个 `rich-model` / `template` 单测全绿，`rich-model.js` 与 `tests/template.test.js` 零改动。
- 行为修正提示（有意为之）：**生成中在富文本编辑器按 Enter 不再点中「停止」按钮**。原 `nativeComposerSendButton` 只认 `type==='submit' || /发送|send/`，若站点在生成中把同一按钮改成停止语义，Enter 会被解释为打断回答。现改为「先判停止、再判发送」，生成中按 Enter 变成安全空操作。
- 需用户人工补测（实机）：见第十节。

## 九、发现的问题

1. **单行编号列表切分把分隔符留在了上一条末尾**：`splitInlineNumbered` 的切片终点误把「下一个标记的匹配头长度」加了回去，导致 `1. 甲；2. 乙` 切成 `甲；` 与 `乙`。单测第一条就抓到，已改为切到「下一个标记起点」。
2. **单条消息被误剥编号**：原先「所有非空行都带标记」就剥离，单条 `1. 帮我看看这段代码` 会被改成 `帮我看看这段代码`。发给模型的内容必须与用户写的一致，故加 `nonEmpty.length > 1` 条件。
3. **`pendingResend` 语义自己在测试里写反了**：初版断言期望「`phase==='send'` 时不可重发」，与设计意图（还没点发送，继续即重发）矛盾。实现是对的，改的是测试。
4. **`.btn:disabled` 样式缺失**（视觉走查发现）：空闲态「暂停」按钮已 `disabled` 但外观与可点状态无异。已补 `opacity: .5` 与 hover 抑制。
5. **Edge headless 截图链路再次间歇性「假成功」**：exit 0、无输出、png 不落盘，本次 6 张里稳定失败 1 张（`panel-mo.png`），换文件名、换 profile、换 window-size 均无效，与内容无关。已按 skill 记录的方式处理：不调参，用已落盘的 5 张做视觉校验，墨色主题的正确性由「14 条面板规则全部带前缀 + 57 个令牌引用全部有定义」的静态断言覆盖。
6. 无阻断项。

## 十、遗留问题

1. **Phase-6 发送链路仍未完成实机验收**，而队列 100% 建立在它之上。队列第一次真机运行同时承担 Phase-6 的验收职责：请先用真实页面跑一次单条发送，确认用户气泡真的出现、文本正确，再跑多条队列。
2. **终止判定的实机调参**：`TUNING`（`queue.js:14-25`）里六个数是保守估计值。实机需确认：生成中「停止」按钮的可访问标签是否能被 `/停止|中断|interrupt|stop|abort/i` 命中；若命中失败，判定会走降级阈值（6 次采样 / 4000ms），深度思考阶段可能出现「静默超过 4 秒」而提前推进——**这是本功能最需要实机确认的一点**。
3. **发送频率与风控**：连续自动发送可能触发站点限流（表现为消息发出后 15 秒内没有任何生成迹象，队列会安全暂停）。已内置 ≤20 条上限与 2 秒最小间隔；若实机遇到限流，请把间隔调大而不是去掉守卫。
4. 附件、图片、@引用、联网/深度思考开关等输入形态不在支持范围，队列只发纯文本。
5. 队列面板在右下角栈里位于工具条上方；若与查找面板同时打开，三者的高度叠加可能遮住正文，实机需确认是否要改为「运行中才显示」以外的更省空间形态。

## 十一、与原工单的差异

1. **URL 变化的放行例外**（工单未写）：实现时发现「新会话首条消息会让站点把地址变成会话地址」，若一律中止，队列在新会话里只能发一条。新增 `urlChangeIsOurSend()`，详见第六节。
2. **失败策略更保守**（工单写「错误策略是重试 1 次后暂停」）：实际实现为**不自动重试**，一律暂停并等用户点「继续」；`继续` 仅在「确定没发出去」时才会重发同一条。理由：自动重试有把同一条消息发两遍的风险，而重复提问对用户的伤害大于多一次点击。
3. **抽出 `queryTurns()`**：工单写「classify 与队列采样共用同一口径」，实现时把 classify 内联的查询提为单例（行为等价重构，已在回归确认）。
4. **popup 录题区在有队列时自动收起**（工单未写）：视觉走查发现 560px 高度下进度列表被输入区挤到只剩一行；且页面侧本就拒绝运行中另起一队，收起与行为一致。
5. **补 `.btn:disabled` 样式**（工单未写）：视觉走查发现禁用按钮无视觉差异。
6. **`parseQueueText` 增加单行编号列表切分**（工单只写「行首有序标记剥离」）：用户示例是单行 `1. …；2. …；3. …` 形态，故补该启发式；并有「单条不剥离」的保守兜底。
7. 其余与工单一致，无白名单外修改。

## 十二、功能状态变化

- 新增功能：**对话队列（功能 15）** —— `已交付（v0.3.24，待用户实机验收）`；范围：同会话内一次性提交最多 20 条纯文本，逐条自动发送，可暂停/继续/清空。
- popup 分区数：4（阅读 / 模板 / 操作 / 收藏）→ 5（阅读 / 模板 / 操作 / **队列** / 收藏）。
- 新增消息类型：`DOCDEEP_QUEUE`（popup → content，带快照回执）、`DOCDEEP_QUEUE_STATE`（content → popup 广播，节流 500ms）。
- 新增注入节点：`#docdeep-queue`（挂 `#docdeep-dock`，随 `setOn(false)` 摘除）。
- 存储键、权限、host、导出函数、`DEFAULTS`（八键）、`background.js`：不变。
- 行为修正：生成中按 Enter 不再点中「停止」按钮。
- 版本：`0.3.23` → `0.3.24`（三处 + popup 可见版本同步）。

## 十三、下一阶段建议

- 建议用户实机验证顺序（从风险最高的开始）：
  1. 重载扩展 → 打开一个**已有对话** → 单条发送一条消息，确认发送链路本身可用（Phase-6 欠账）。
  2. 队列分区写入 2 条短问题 → 点「加入队列并开始」→ 观察：第一条发出、页面出现回答、答完后约 2 秒自动发第二条、结束显示「已完成 2/2」。
  3. 重点看**深度思考阶段的判定**：如果下一条在回答还没结束时就被发出（或反之，答完了却迟迟不发下一条），把现象与耗时记下来——需要按第十节第 2 条调 `TUNING`。
  4. 运行中点「暂停」→ 确认回答继续生成但下一条不再发出 → 点「继续」→ 确认从当前条目续上（不会重发已发出的）。
  5. 运行中手动切到另一个会话 → 确认队列停止并提示「会话已切换，队列已停止」。
  6. 运行中关闭扩展总闸 → 确认面板消失、不再发送。
- 需用户确认后才另开工单的候选项：队列间隔与条数上限做成可配；运行中允许追加条目（当前是「运行中拒绝另起一队」）；按会话隔离多队列。

## 十四、等待用户验收

**状态：等待用户实机验收对话队列。** 在用户明确验收前，不追加队列的高级能力（附件、多队列、断点续跑、跨会话队列），不动 `TUNING` 之外的判定策略，不开新阶段。
