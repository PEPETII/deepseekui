# Phase 3 工单计划（功能3-MVP：选择性导出MD + front-matter + 代码语言保留）

## 一、阶段目标

交付选择性导出 MVP：大纲每 Q 可勾选（`key` 为键，不依赖 DOM）+ 全选/清空/仅看已选 + 导出选中 MD（含 front-matter + 代码语言围栏），与现有全量导出共存、默认仍全量。HTML 自包含、JSON 选择性、自动备份/全局搜索不在本 Phase。不新增 host 权限/远程 fetch，版本号保持 `0.3.1`。

## 二、本阶段涉及的功能

- 功能 3-MVP：仅勾选导 MD + front-matter + 代码语言保留。
  - 勾选源复用 `qOrder/qInfo`；选中集 `Set<key>` 内存态（不落盘，随 URL 变化清空，与 `qOrder` 同生命周期）。
  - 导出过滤：`filterRecordsByQ(records, selectedKeys)` + `buildMarkdown(records, title, {frontMatter, qNumberOf})`；选中为空给人话并中止；未触碰勾选（`null`）或全选即全量。
  - front-matter：`title/url/exportedAt/schemaVersion/selection`，MD 全量/选中均带。
  - 代码语言：`cleanTurnText` 内 `pre` 转 ```lang 围栏（`parseCodeLang` 纯函数），`copyFull`/查找复用同一文本口径。
- 地基复用：`collectAllTurns` 全量爬取后过滤（不另写采集循环）；定位仍走 `scrollToStoredQuestion` 单例；`olReg` 保持全量。

## 三、本阶段不处理的内容

- 功能 3-HTML 自包含单文件（Phase-4）、JSON 选择性（本 Phase JSON 保持全量，即使收到 `onlySelected` 也按全量？实际实现为 MD/JSON 同过滤，但 UI 只暴露 MD；以代码注释为准）。
- 功能 4（自动备份）、功能 6（全局搜索）、功能 9 剩余（`o`/`/`/`Alt+K`）、功能 10 剩余高级管理。
- `PAPER-WIDTH-001` 解冻、`background.js` 下载链路（MIME/文件名清洗不动）、`classify/mergeQuestionOrder/alignNativeWithRegistry/collectAllTurns/scrollToStoredQuestion` 算法本体不动（只复用调用；`buildMarkdown/buildExport/cleanTurnText` 渲染/文本层除外）。
- 不新增 host 权限/远程 fetch/BYOK；不改 `docs/known-issues.md` 结论（只可追加）；版本号保持 `0.3.1`。

## 四、前置条件

- Phase-2 已验收：`J/K/?` + 总闸 + 一键补全 + 过滤/M/N/收藏管理可用；`qOrder` 全局顺序 + `scrollToStoredQuestion` 单例有效。
- Chrome 109+ 可加载目录；popup 非 DeepSeek 页可打开。

## 五、代码影响范围（白名单）

- 允许：`content.js`（新增 `selectedQKeys/onlySelectedView` 状态 + `parseCodeLang/fenceCode/buildFrontMatter/filterRecordsByQ` 纯函数 + `ensureOutlineShell` 勾选栏/复选框 + `buildOutline` 选择过滤/签名/计数 + `buildMarkdown/buildExport` front-matter/编号保持 + `cleanTurnText` pre围栏 + `exportConversation(format, {onlySelected})` + `onMessage.DOCDEEP_EXPORT.onlySelected` + `setOn(false)` 状态清理）、`content.css`（勾选行/栏/mo/打印）、`docs/*`。
- 禁止：`manifest.json` 权限/host、`background.js`、`popup.html/js`（本 Phase 不动，导出入口传参仅 content 侧预留 `onlySelected`，popup 仍发全量）、`content.js:classify/mergeQuestionOrder/alignNativeWithRegistry/collectAllTurns/scrollToStoredQuestion` 本体、`content.css` 纸宽祖先规则、`docs/known-issues.md` 改写。

## 六、任务拆解

### Task 1 开发（主代理串行，一次改完 content.*，避免同文件冲突）

目标：勾选 + 选择导出可用，可摘除，默认不打扰。

涉及文件：`content.js`、`content.css`。禁止改白名单外。

实施内容：
1. 状态：顶层新增 `let selectedQKeys = null`（`null`=未触碰=全量；`Set`=已触碰）+ `let onlySelectedView = false`；`setOn(false)` 清空两者 + URL 变化（`classify` 内 `urlChanged` 分支）清空两者（与 `qOrder` 同命）；关闭时勾选节点随 `.docdeep-injected` 自动摘除。
2. 纯函数（Node 可测，不碰 DOM）：
   - `parseCodeLang(className)`：从 `language-xxx` 取语言（容错空/多类/大小写），无则空串。
   - `fenceCode(lang, code)`：返回 ```` ```lang\ncode\n``` ````（code 去尾换行，空 code 返回空串）。
   - `buildFrontMatter({title, url, exportedAt, schemaVersion, selection})`：YAML `---` 块，`title` 转义双引号，`selection` 为 `"all"` 或 `"Q2,Q5"`（按 `qOrder` 顺序）。
   - `filterRecordsByQ(records, selectedKeys)`：`selectedKeys` 空/null 即原样返回全量；否则按“user 问切分归属”保留选中 Q 及其后随 AI 答（首个 Q 之前的悬空 AI 跳过）；保持原顺序。
3. 文本口径：`cleanTurnText` 内先将 `clone.querySelectorAll('pre')` 替换为围栏文本节点（语言经 `parseCodeLang(code.className + ' ' + pre.className)`，正文经 `code.innerText||textContent`），再删注入节点后取 `innerText`。`turnRecord/collectVisibleTurns/copyFull/refreshFindResults` 复用同一口径，不另写第二套。
4. Markdown：`buildMarkdown(records, title, opts)` 新增 `opts={frontMatter, qNumberOf, selectionLabel}`；`frontMatter` 为真（默认真）即头部加 `buildFrontMatter`；user 标题编号优先用 `opts.qNumberOf(key)`（保持原 Q 号，如 `Q7`），无则回退顺序号；`buildExport(format, records, title, opts)` 透传 `opts`（JSON 仍无 front-matter，保持原结构）。
5. 大纲 UI：`ensureOutlineShell` 新增 `div.doc-ol-selbar(INJECTED)`（全选/清空/仅看已选/导出选中，全部 `type=button` + `aria-label`），位于补全按钮下、列表上；Q 行结构改为 `div.doc-ol-row > input.doc-ol-check[type=checkbox](INJECTED, aria-label=选择 Qn) + button.doc-ol-item`，h 行保持单 button（但补 `owner` 归属供仅看已选过滤）；复选框 `change` 冒泡由行内监听处理，`keydown` 需 `stopPropagation`（仿过滤框，避免触发 J/K）。
6. `buildOutline`：`items` 中 h 项补 `owner`（其归属 Q key 或 `'__head'`）；选择工具栏计数 `导出选中（n/M）`（`n`=选中数，`null` 视为 M）；`matchItem` 叠加仅看已选（Q 看自身选中，h 看 `owner` 选中，`__head` 在仅看已选时隐藏）；签名追加 `|s:`（选中签名：`null`记 `all`，否则按 `qOrder` 顺序 0/1 串）+ `|o:`（仅看已选 0/1），`olReg` 保持全量（含隐藏项），`spy` 跳过逻辑复用（已跳 `display:none`，行容器隐藏需同步隐藏 button）。
7. 导出：`exportConversation(format='md', opts={})` 支持 `opts.onlySelected`；为真且 `selectedQKeys!==null` 且非全选时先 `filterRecordsByQ`，空结果 toast“请先勾选要导出的提问”并中止；进度/取消/互斥/`finally` 恢复滚动逻辑不变；采集仍全量爬取后过滤（保证未挂载选中 Q 的 AI 答能拿到）；`onMessage.DOCDEEP_EXPORT` 透传 `onlySelected: !!msg.onlySelected`（popup 仍全量，预留）。
8. CSS：`.doc-ol-row`（flex 对齐）+ `.doc-ol-check`（accent-color + margin）+ `.doc-ol-selbar`（grid/换行小按钮）+ `:disabled` + `mo` 分支；全部 `html[data-docdeep="on"]` 开头；打印随大纲隐藏（大纲已在 `@media print` 隐藏，需确认勾选栏/框无单列遗漏）。

验收标准：
- 默认（未触碰）导出 MD 带 front-matter 且内容=全量；勾选 Q2/Q5 后导出仅含 Q2/Q5 及其 AI 答 + 小节，且标题保持原号 `Q2/Q5`，front-matter `selection: "Q2,Q5"`。
- 全选/清空/仅看已选即时生效；空选中导出给人话不落文件；过滤词 + 仅看已选可叠加；`setOn(false)` 后勾选栏/框摘除干净，重开为全量。
- 代码块导出为 ```lang 围栏（有语言保留语言，无语言纯围栏）；`node --check` 通过。

风险：`button` 内嵌 `input` 非法故改行容器结构，需回归 `spy/active` 与点击定位；`cleanTurnText` 加围栏需确认查找/复制无退化（仅文本增围栏标记）。

### Task 2 测试（主代理自测，只读+临时夹具，不改业务）

目标：独立验证 + 回归表。

实施内容：
- Node：`parseCodeLang/fenceCode/buildFrontMatter/filterRecordsByQ/buildMarkdown（含front-matter/原号保持/回退序号）` 纯逻辑（空/全选/部分/悬空AI/乱序/空code/标题含引号）；导入往返仍一致（Phase-1 无退化）；J/K/补全关键函数仍存在。
- 夹具/DOM 走读：复选框 `INJECTED+type+aria`、`stopPropagation`、工具栏四按钮 `type=button`、签名含 `|s:|o:`、`olReg` 全量、空选中人话、`finally` 恢复滚动、打印隐藏、摘除。
- 回归：Phase-1/2 全量（收藏/过滤/M/N/补全/J/K/?/总闸）+ 原回归（开关/字号/主题/大纲开关/复制/导出MD+JSON含取消/打印/查找↑↓/诊断/侧栏/收藏/流式/闪烁）。

验收标准：矩阵（用例/预期/实际/通过），失败阻断，声明无实机局限。

### Task 3 Review（主代理只读 diff）

目标：放行门。查可摘除、存储兼容（本 Phase 无新存储键，选中态内存化 + URL 切换清空）、消息兼容（`DOCDEEP_EXPORT.onlySelected` 可选）、CSS 前缀/mo/打印、快捷键冲突（复选框不过 J/K）、重复实现（采集/滚动单例、前 matter 单函数）、白名单外修改、版本号三处一致。输出放行/打回（带行号）。

## 七、测试计划

- 新功能：默认全量带 front-matter；部分选中过滤 + 原号保持；全选=全量；清空后导出人话中止；仅看已选 + 过滤词叠加；悬空 AI 跳过；标题引号转义；有/无语言代码围栏；`onlySelected` 经消息透传。
- 边界：`qOrder` 空（工具栏禁用/人话）、单 Q、100 上限、`selectedQKeys` null/空/全、记录乱序、空 code、非 DeepSeek 页。

## 八、回归测试范围

Phase-1 全量（收藏搜索/筛选/改名/导入导出往返/大纲过滤/无匹配/M/N）+ Phase-2 全量（J/K 跨未挂载/边界/忙互斥/总闸/?帮助/Esc/补全三态/取消/恢复位）+ 原回归（开关恢复原站/字号/主题/大纲开关/复制/导出MD+JSON含取消/打印/查找↑↓/诊断版本一致/侧栏过滤/收藏打开删除/流式无重复/滚动无卡顿）。

## 九、完成定义 Definition of Done

- 白名单 diff 可 Review，无 console 报错；测试+Review 放行；失败记报告并阻塞。
- `docs/功能扩展规划.md` 功能 3 更新为 Phase-3 记录；完成报告基于真实 diff。
- `setOn(false)` 后勾选 UI 摘除；popup 280px 不撑高（本 Phase 未动 popup）；空/忙/边界均有人话。

## 十、进入下一阶段的条件

- Task1-3 完成并整合，无冲突、无白名单外修改。
- 已汇报并等待验收；用户未说“验收通过/可以继续/开始下一阶段”前不得动 Phase-4 代码。
