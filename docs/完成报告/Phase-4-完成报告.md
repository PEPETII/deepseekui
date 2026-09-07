# Phase 4 完成报告（收官：4自动备份 + 6全局搜索MVP + 3-HTML自包含）

## 一、阶段目标回顾

按 `docs/工单计划/Phase-4.md`：交付收官三件套——功能 4 自动备份（默认关、可配间隔/条数、轻量快照、`docdeep_history_v1` 时间线）+ 功能 6 全局搜索 MVP（标题+Q首句+tag 索引，新标签打开原文）+ 功能 3 HTML 自包含单文件。三者与现有功能共存，默认不打扰。版本号保持 `0.3.3`。

## 二、已完成任务

- Task 1 开发A（content.js）：备份生产端 + HTML 生成端。
- Task 2 开发B（popup.*/background.js）：备份消费端 + 全局搜索 + HTML 入口/mime。
- Task 3 测试：Node 自测 83 断言 ALL_PASS + 结构走读 + 回归。
- Task 4 Review：白名单/兼容/可摘除放行门。
- 主代理整合：工单起草 + 串行实现 + 自测复核 + 本报告 + 规划文档/`AGENTS.md` 同步。

## 三、实际修改内容

- `content.js`：
  - `DEFAULTS` 加 `docdeep_backup:false/docdeep_backup_mins:10/docdeep_backup_keep:10`（9 键）；`HISTORY_KEY/HISTORY_HARD_MAX=20/MD_MAX=20000` 常量；`lastBackupAt/lastBackupHash` 状态。
  - `snapshot()` 加可选 `backup:{on,lastAt}`；`heartbeat()` 末尾加 `maybeBackup()` 钩子（不 await）；独立 `setInterval(60s)` 节拍兜底；`onChanged` 监听追加三键。
  - `pruneHistoryList/maybeBackup`：只读当前已挂载（`collectVisibleTurns` 新 Map，零滚动）→ 指纹（key+长度+标题，仅变化写）→ `buildMarkdown` 组 `md`（20000 截断记 `chars/truncated`）+ `qFirsts`（50 条×80 字）→ 按 `id=url` upsert → 倒序 → `min(keep,20)` → 写库；配额三级降级（完整→元数据→逐半裁剪→warn 收场）；与 `exportState/outlineComplete` 互斥；`setOn(false)` 重置指纹。
  - HTML：`escapeHtml/mdToHtmlBody/buildHtml`（单文件内联样式，无外链无远端图片无 script）+ `buildExport` html 分支 + `fallbackDownload` html 分支 + 工具条“导出 HTML”按钮 + `DOCDEEP_EXPORT` format 路由补 `html`（此前 `html` 会被吞成 `md`，属必须修）。
- `background.js`：仅加 `html:text/html/.html` mime/扩展名分支；`safeFilename`/空串/回调逐行不动。
- `popup.html`：设置卡加备份开关行 + 间隔/条数 select；新增“全局搜索”卡（`#global-search[type=search,aria-label]` + `#global-results`）与“历史备份”卡（`#history-list`）；导出行加 `#export-html[type=button]`；顺手将全文件剩余无 `type` 按钮补齐 `type="button"`（Phase-1 遗留第 3 条彻底收敛）。
- `popup.js`：`DEFAULTS` 9 键 + `HISTORY_KEY/HARD_MAX/MD_MAX` 常量；`buildBookmarksExport` settings 9 键（老文件无该段仍可导入）；`paint()` + 备份三控件接线（仿 `ol/keys`）；纯函数 `normalizeHistoryEntry/migrateHistory/pruneHistory/buildGlobalIndex/filterGlobalIndex`；`loadHistory/renderHistory/removeHistoryEntry/exportHistoryEntry`（打开/删除/导出单条，blob fallback，人话）；`renderGlobalResults`（防抖150ms + 惰性预热 + 30 条上限 + 空状态）；`load()` 加 `loadHistory()` + 预热；诊断 `check` 加备份行；报告 settings 加 backup 三键；`module.exports` 扩展。
- `docs/工单计划/Phase-4.md`：新建（十节模板）。
- 未动：`manifest.json` 权限/host、`content.css`（零改）、`classify/mergeQuestionOrder/alignNativeWithRegistry/collectAllTurns/scrollToStoredQuestion` 本体、`content.css` 纸宽祖先规则、`docs/known-issues.md` 结论、三处版本 `0.3.3`。

## 四、新增文件

- `docs/工单计划/Phase-4.md`（本阶段工单）
- `docs/完成报告/Phase-4-完成报告.md`（本文件）
- 无新增业务代码文件（刻意不新增 `search.js`，索引函数内聚 popup，便于单测；自测脚本放系统临时 scratchpad，未进仓库）。

## 五、修改文件

- `content.js`：备份生产端 + HTML 生成端（`node --check` 通过）。
- `background.js`：html mime 分支 5 行（`node --check` 通过）。
- `popup.html/js`：备份/搜索/历史 UI + 接线 + 纯函数（`node --check` 通过）。
- `AGENTS.md`：架构行（9键/历史快照/HTML mime/PING备注）+ DEFAULTS 基准 9 键 + DOWNLOAD format 注明。
- 确认未改：`manifest.json`、`content.css`。

## 六、关键实现说明

- 默认不打扰：备份默认关（`docdeep_backup:false`），关时 `maybeBackup` 首行即返，零写入零定时开销（节拍回调仅过守卫）；搜索空查询返空数组 + 人话引导；HTML 与 MD/JSON 入口共存。
- 零滚动备份：`maybeBackup` 只用 `collectVisibleTurns` 读已挂载，不调 `collectAllTurns`；与导出/补全互斥（运行时跳过）；心跳钩子不 await；60s 独立节拍覆盖页面闲置无 mutation 场景。
- 仅变化写：指纹=`hashText(key:len 串 + title)`；相同指纹只刷新 `lastBackupAt` 不写库；间隔钳制 1..60 分钟，保留钳制 1..20 条（硬上限 20，与书签 100 隔离）。
- 配额链：完整（含 md≤20000 + qFirsts）→ 元数据（md:'', qFirsts:[], 保留计数）→ 逐半裁剪 3 轮 → `console.warn` 收场；`lastBackupHash` 仅成功才更新，`lastBackupAt` 尝试即更新（防热循环）。
- 索引最小：`buildGlobalIndex` 只取标题/tag/url/Q首句，不含 AI 全文与 md；`filterGlobalIndex` 大小写不敏感子串，命中片段优先 Q 首句（`命中提问：…60字`），回退标题；结果按 `updatedAt` 倒序；点击只 `chrome.tabs.create({url})`，deep-link 未做。
- HTML 安全：全字段 `escapeHtml`；围栏→`<pre><code data-lang>`；`##→h2`；`---→hr`；其余分段→`<p><br>`；无 `src=/img/script` 远端；`buildExport` JSON 分支不动；老 `DOCDEEP_EXPORT` 无 format 即 md。

## 七、测试结果

- `node --check` 三 JS 通过。
- Node 自测 83 断言 ALL_PASS：popup 默认（9键/关/10/10/老配置关/导出9键）6；历史纯函数（null/脏URL/基本/截断/默认标题/迁移排序去重/非数组/裁剪/钳制）10；索引搜索（条数/倒序/无全文/标题命中/大小写/tag/空查询/无匹配/片段/非数组）10；Phase-1 往返 1；content 函数存在 15；HTML 镜像（h2/围栏语言/转义/hr/空/无远端）6；content 结构（9键/onChanged9/快照/60s/心跳/互斥/零滚动/配额/截断/按钮/路由/分支/fallback）12；background（html/清洗 intact）2；popup 结构（paint/接线/导出/历史/搜索/诊断/报告）7；popup.html（备份行/按钮/搜索/历史/type全量）5；白名单（权限/版本×3/零CSS/零权限/零fetch）7。
- 自测纠偏两处（非业务 bug）：`html-user-h2` 期望误写整串匹配（`stripQuestionLabel` 对 `Q7 我的提问帮我写代码` 无 `·` 分隔故整体保留），改为包含式；`popuphtml-type-button` 初版失败——全文件老按钮（sw/copy/top/find/print/export-md/json/bookmark/check/report）缺 `type`，已全量补齐后通过（Phase-1 遗留第 3 条彻底收敛）。
- DOM 走读（代码级，未实机）：备份开→60s 内首条→变化增写→时间线倒序→打开/删除/导出单条；搜索三源命中→倒序→空状态；HTML 双链路落 `.html`；关闭扩展后备份指纹重置；非 DeepSeek 页全控件可点。
- 局限声明：无浏览器实机环境，定时节拍/配额降级/长会话虚拟列表/打印预览需用户侧 Chrome 人工补测。

## 八、回归测试结果

- 走读级通过（未实机，已声明局限）：Phase-1（收藏搜索/筛选/改名/导入导出往返/大纲过滤/无匹配/M/N）+ Phase-2（J/K/边界/互斥/总闸/?/Esc/补全三态/取消/恢复位）+ Phase-3（勾选/全选清空仅看/选中导出原号/front-matter/围栏）+ 原回归（开关恢复原站/字号/主题/大纲开关/复制/导出MD+JSON含取消/打印/查找↑↓/诊断版本一致/侧栏过滤/收藏打开删除/流式无重复/滚动无卡顿）。
- 需 Chrome 人工补测：备份间隔/条数生效、配额满人话、历史导出往返、全局搜“向量检索阈值”直达、HTML 离线打开、墨色/打印无影响（content 无新浮层，CSS 零改）。

## 九、发现的问题

- 无阻断项。Review 放行。另修两处工单未预见但必须修：`DOCDEEP_EXPORT` format 路由补 `html`（否则 HTML 入口被吞成 MD）；`setOn(false)` 补 `lastBackupHash=''`（否则重开后首变不写）。
- 自测期望纠偏两处（见第七节），均非业务 bug。

## 十、遗留问题

1. `inp._olT` 在 `setOn(false)` 未 `clearTimeout`（Phase-1 遗留，仍未清；空触发一次即返，可后续顺手清）。
2. `buildOutline` 过滤仍跑 `updateQuestionRegistry+renumber` 对账（Phase-1 遗留，性能优化延后）。
3. 人工实机回归未做（无浏览器环境），需用户侧加载验证（延续）。
4. `?docdeep_q=` deep-link、`o`/`/`/`Alt+K`、AI 全文索引、分词、HTML 图片内嵌、导出模板未做（按需后续）。

## 十一、与原工单的差异

- 三处收敛（均在白名单内，无行为偏离）：popup 全文件按钮补 `type="button"`（含 Phase-1 老按钮）；`setOn(false)` 补指纹重置；`mdToHtmlBody` 用户问分支去掉冗余 `.replace`（恒等替换，无语义）。
- 其余与 `docs/工单计划/Phase-4.md` 一致；版本号保持 `0.3.3`；`content.css` 零改（工单允许但实际无需新浮层）。

## 十二、功能状态变化

- 功能 4：`待实施` → `进行中`（MVP 已交付：备份开关/间隔/条数 + 时间线 + 配额降级）。
- 功能 6：`待实施` → `进行中`（MVP 已交付：联合索引 + 搜索 + 打开原文）。
- 功能 3：`进行中` → `进行中`（+HTML 自包含已交付；剩余模板/图片内嵌按需）。
- 功能 5/9：不变（5 已完成；9 已完成 J/K/?）。
- 功能 10：不变（进行中 MVP；后续可复用 schema 做高级管理）。
- 整轮目标（3/4/5/6/9/10）至此全部收官，无 Phase-5。

## 十三、下一阶段建议

- 无下一阶段。本轮路线图最后一环已交付。建议用户实机验证：开备份浏览→时间线首条→改动后增写→搜关键词命中→HTML 导出离线打开→诊断备份行→关闭扩展恢复原站。
- 后续按需项（均不在本轮）：deep-link 直达 Q、AI 全文索引/分词、HTML 图片内嵌、导出模板、`o`/`/`/`Alt+K`、`inp._olT` 清理、对账性能优化。

## 十四、等待用户验收

**状态：等待用户验收 Phase 4（收官）。** 本轮目标全部完成后，不再自动进入新阶段；新需求请另起工单。
