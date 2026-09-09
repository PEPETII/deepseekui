# AGENTS.md

> 本文件约束所有参与本项目（DeepSeek 文档化阅读 v0.3.x）开发的代理行为。基于真实代码结构制定，非通用模板。

## 项目简介

Manifest V3 纯本地 Chrome 扩展，把 `https://chat.deepseek.com/*` 重排为中文文档工作台：阅读排版、右侧大纲、会话内查找、全量导出（MD/JSON）、打印、本地收藏。原则：只打标 + 注入可摘除 UI，不挪动 textarea/form/发送按钮，不读 token/cookie，不调私有 API，不改 fetch（见 `content.js:1-5`）。

当前版本：`0.3.20`（`manifest.json` / `popup.js:POPUP_VER` / `content.js:VERSION` 三处必须同步）。

## 项目架构

```
popup.html/popup.js  -> 面板：设置、大纲开关、复制/查找/打印/导出触发、收藏管理
content.js/css       -> 内容脚本：classify 打标、qOrder 注册表、大纲、工具条、查找面板、导出采集器（含HTML）、侧栏过滤
background.js        -> 仅下载服务：DOCDEEP_DOWNLOAD -> chrome.downloads（data URL，支持 md/json/html）
chrome.storage.local -> 设置6键 + 书签
消息总线             -> DOCDEEP_TOGGLE/SETTINGS/TOP/FIND/PRINT/COPY/EXPORT
```

无构建步骤、无后端、无 npm，直接加载目录即运行。

## 主要目录职责

* `manifest.json`：权限（`storage,downloads` + host `chat.deepseek.com/*`）、content_scripts、action popup。加权限必须在工单中说明。
* `content.js`（~1351行）：唯一可碰 DeepSeek DOM 的文件。含 `classify/updateQuestionRegistry/mergeQuestionOrder/buildOutline/collectAllTurns` 等核心。修改需极谨慎。
* `content.css`：所有规则必须以 `html[data-docdeep="on"]` 开头；`@media print` 独立段。禁止全局选择器。
* `popup.js/html`：面板逻辑 + 收藏存储。`popup.html` 内联 `<style>`，改 UI 同步改两处。
* `background.js`：仅下载。禁止在此加 DOM 逻辑或扩大权限。
* `docs/`：`known-issues.md`（历史问题归档）+ `功能扩展规划.md`（长期记录）+ `工单计划/` + `完成报告/`。
* `AGENTS.md`：本文件。

## 开发原则

1. 可摘除原则：所有注入节点带 `docdeep-injected` 类（或 `id=docdeep-*`），`setOn(false)` 必须完整摘除并恢复原站（参考 `content.js:54-98`）。
2. 只读优先：探针/大纲/统计只读原文 DOM，绝不点击、改样式、挪动原生节点（原生目录 `probeNativeOutline` 为范例）。
3. 虚拟列表假设：任何时候只信“已挂载子集”，全集必须经 `qOrder/qInfo` 累积 + `mergeQuestionOrder` 对账。禁止用 `qCounter++` 先见先编号。
4. 选中/定位以 `key`（`u:/a: + message-id或文本哈希`）为键，禁止以 DOM 引用为长期状态。
5. 性能：`classify` 防抖（120ms）、`heartbeat` 节流（4s）、大纲签名比对跳过（`list.dataset.signature`）、滚动采集步进 + 取消。流式时零 churn。
6. 最小侵入：一次只改白名单文件；修 A 功能不顺手改 B 功能样式。

## 子代理协作规则

* 主代理负责：架构决策、阶段规划、任务拆分、调度、整合、审查、测试确认、文档维护、向用户汇报。
* 子代理必须有明确：任务、文件范围、输入、输出、禁止修改范围、验收标准（见各 Phase 工单）。
* 同一核心文件（如 `content.js`、`popup.js`）不得多代理无控制并行写。优先拆责任边界（例：A 只改 `popup.*`，B 只改 `content.*`），或串行，或一写多 Review。
* 子代理输出必须可验证：给出修改文件 + 行号 + 自测结果，不得只说“已完成”。
* 主代理负责最终整合与冲突解决。

## 修改代码前必须执行的检查

1. `Read` 目标文件全文（或相关段）+ `docs/known-issues.md` 相关条目（尤其 `PAPER-WIDTH-001 / OUTLINE-ORDER-001 / NATIVE-OUTLINE-001`）。
2. 确认三处版本号是否需同步（改行为逻辑一般需 bump）。
3. 确认 `chrome.storage` 新键是否有默认值 + 老版本迁移路径。
4. 确认 CSS 新增规则是否以 `html[data-docdeep="on"]` 开头，打印规则是否进 `@media print`。
5. 确认快捷键是否与输入框冲突（必须过 `isEditableTarget`）。

## 禁止随意修改的区域

* `PAPER-WIDTH-001` 冻结区：`content.js:applySettings/setOn` 强制 `880` + `popup.html:42 disabled`。Phase-2 前不得解冻，动即需工单说明。
* `classify` 指纹/角色对账核心（`data-docrole/data-docfp`）非必要不动；动必须有虚拟列表复用场景的回归用例。
* `background.js` 下载 MIME/文件名清洗（`safeFilename`）逻辑，防路径穿越。
* `manifest.json` 权限/host：加 `sync/contextMenus/sidePanel/<all_urls>` 需用户明确确认。
* `docs/known-issues.md` 历史记录：只追加，不改写结论。

## 配置兼容原则

* `DEFAULTS = { docdeep_enabled, docdeep_width, docdeep_font, docdeep_theme, docdeep_outline, docdeep_keys }` 为基准，新增键必须进 `DEFAULTS` 并给安全默认值（新功能默认关或最保守档）。
* 老用户存量配置必须有效：`applySettings` 做 `{...DEFAULTS, ...stored}` 合并 + 冻结/钳制（如纸宽钳制 880）。
* `chrome.storage.onChanged` 监听新增键时，必须增量 `applySettings` + `classify()`，不得全量重置 `qOrder`（URL 变化除外）。
* Phase-1 起引入 `docdeep_schema_ver`（整数，当前 2），迁移函数 `migrateBookmarks()` 幂等、可重入。

## 数据兼容原则

* 书签数组上限 100，单 `tag` 24 字，`title` 非空回退 `未命名会话`，仅接受 `https://chat.deepseek.com` URL（`isDeepSeekUrl` 校验）。导入必须复用同一校验 + 去重（以 `id=url` 去重保序）。
* `storage.local` 配额约 5-10MB：大文本写入必须截断 + 存计数；写前 `try/catch` 配额失败降级并给人话提示。
* 心跳/诊断自证链路已于 v0.3.20 删除（含 `docdeep_heartbeat` 键，popup `load()` 主动清理）；如未来新增快照/报告类数据，新字段必须可选（`snap.xxx ?? 缺省`）保证新旧版本互读不崩。
* 禁止采集 token/cookie/账号信息；任何导出/报告类内容不得包含对话正文。

## UI 修改原则

* popup 宽 280px 卡片体系不变；新增控件沿用 `.card/.row/.btns` 样式；收藏列表 `max-height` 内滚动，不得撑高面板。
* 内容脚本新增浮层 `z-index: 2147483000` 系，`position: fixed`，墨色主题需同步配色（`[data-doctheme="mo"]` 分支）。
* 所有按钮 `type="button"`，输入框有 `aria-label`；空状态有人话（例：暂无收藏/无匹配）。
* 查找/大纲高亮只动注入节点类名（`.active/.doc-search-hit`），不动原文样式。

## API 修改原则

* 消息类型 `DOCDEEP_*` 全大写下划线，新增类型必须在 `content.js:onMessage` + `popup.js:notify/sendPage` 两端处理未知类型（默认忽略），`send` 回调必须判 `chrome.runtime.lastError`。
* `background.js` 仅接受 `{type:'DOCDEEP_DOWNLOAD', format, filename, content}`（`format: md/json/html`），`content` 非 string 即空串，`filename` 经 `safeFilename`。
* 不得为新功能新增 host 权限或远程 fetch；BYOK 类联网功能默认关闭且独立模块，密钥仅存本地、不进任何报告或导出。

## 测试要求

* 每个 Task 必须自测：正常路径 + 至少 2 个边界（空配置/非法输入/非 DeepSeek 页/老版本数据/存储失败）。
* popup 逻辑无浏览器时，用 Node 对纯函数（`normalize/migrate/filter`）做单测；DOM 逻辑用最小 HTML 夹具验证。
* 大纲/定位改动必须在“长会话（虚拟列表回收）+ 流式中 + 回到顶部”三场景下验证编号不抖动。
* 导入/导出往返测试：导出→清空→导入→一致。

## 回归测试要求

* 必跑：开关启停恢复原站、字号/主题/大纲开关、复制全文、导出 MD/JSON（含取消）、打印样式、查找 ↑↓、侧栏过滤、收藏打开/删除。
* 性能回归：流式时无按钮重复、无大纲闪烁；滚动时 `classify` 无卡顿。
* 失败即阻断：回归任一失败不得标完成，需记入完成报告“发现的问题”。

## 文档维护要求

* `docs/功能扩展规划.md` 为唯一长期真相源：每完成 Task/Phase 同步更新状态、Phase 归属、工单/报告链接。聊天汇报不替代文档。
* 每 Phase 一份工单（`docs/工单计划/Phase-X.md`，十节模板）+ 一份完成报告（`docs/完成报告/Phase-X-完成报告.md`，十四节模板），报告基于真实 diff 填写，禁提前建空报告。
* 重要架构调整必须同时写进工单“与原计划差异”与报告“差异”节，不得悄悄改需求。

## 工单执行规则

* 任务拆到可执行可验证粒度（目标/代理/文件/内容/验收/风险），禁写“实现功能 X”一句话任务。
* 白名单外文件禁止改；需扩大范围先更新工单并说明理由。
* breaking change 必须先在工单中声明并获用户确认，否则按兼容方案做。

## 阶段验收规则

* 流程：工单 → 开发 → 测试 → 回归 → 报告 → 汇报 → **停止等待用户验收**。
* 用户未明确说“验收通过/可以继续/开始下一阶段”或同等含义，**不得进入 Phase N+1**，即使自认为简单。
* 验收前不得创建下一 Phase 的实现代码或修改，仅可做只读分析。

## Git / 工作区安全规则

* 本工作区当前非 git 仓库：不得 `git init` 揣测；若后续有仓库，提交前 `git status/diff/log` 检查，仅 stage 本轮文件，禁 commit secrets，禁 force-push/--amend 失败提交、不跳 hooks。
* 发现与本轮无关的未提交修改：不删除、不覆盖、不 reset、不格式化、不混入本轮 diff。如需动，先向用户报告。
* 删文件用带引号 `Remove-Item -LiteralPath`，路径含空格/中文必须双引号；不在命令内 `cd`，用 `workdir` 参数。
* 临时工作目录用 `C:\Users\KING\AppData\Local\Temp\opencode`（已预批准），勿在仓库外乱建。
