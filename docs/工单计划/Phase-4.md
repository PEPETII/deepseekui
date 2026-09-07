# Phase 4 工单计划（收官：4自动备份 + 6全局搜索MVP + 3-HTML自包含）

## 一、阶段目标

交付收官三件套：功能 4 自动备份（默认关、可配间隔/条数、轻量快照、`docdeep_history_v1` 时间线，崩溃可找回）+ 功能 6 全局搜索 MVP（只索引标题+Q首句+tag，大小写不敏感，新标签打开原文）+ 功能 3 HTML 自包含单文件（内联样式、离线可读、图片延后）。三者与现有全量/MD/JSON/勾选导出共存，默认不打扰老用户。不新增 host 权限/远程 fetch，版本号保持 `0.3.3`。

## 二、本阶段涉及的功能

- 功能 4-MVP：设置项自动备份开关（默认关）、间隔（默认 10 分钟/仅内容变化才写）、保留条数（默认 10）；快照 `url/title/时间/turns计数/MD前20000字 + qFirsts`，超长截断；配额满降级为仅元数据 + 人话提示；popup 时间线按更新倒序，支持打开/删除/导出单条；定时器与 `exportState/collectAllTurns` 自动滚动互斥，备份只读当前已挂载（不抢滚动）。
  - 存储键 `docdeep_history_v1`（数组，硬上限 20，与书签隔离）；新增设置键 `docdeep_backup:false`、`docdeep_backup_mins:10`、`docdeep_backup_keep:10`，进双端 `DEFAULTS` + `onChanged` + popup 开关行。
  - 复用 `collectVisibleTurns + heartbeat 节流` 做增量保存；先存 `storage.local` 轻量版，不默认写 `downloads`。
- 功能 6-MVP：popup 一框搜书签 + 历史快照；只索引标题+Q首句+tag，不索引 AI 全文；大小写不敏感子串匹配；结果按更新倒序，显示来源标题+tag+命中片段；点击在新标签打开原文（`?docdeep_q=` deep-link 本 Phase 不做，留后续）；无数据/无匹配均有人话空状态；索引惰性构建，不阻塞 popup 打开。
  - 新增 popup 内 `buildGlobalIndex/filterGlobalIndex` 纯函数（便于 Node 单测，不新增 `search.js`，保持最小侵入）。
- 功能 3-HTML：自包含单文件（内联关键样式，图片延后——记录为纯文本，不内嵌远端资源）；离线可读；与 MD/front-matter/原号保持同源；`exportConversation('html')` + 工具条/ popup 双入口；`background.js` 加 `html` mime + `fallbackDownload` 加 `html` 分支（blob 兜底链路保留，失败走 fallback，永不双链路同时崩）。

## 三、本阶段不处理的内容

- `?docdeep_q=` deep-link 直达 Q（留后续 Phase，popup 本 Phase 只打开原文 URL）。
- AI 全文索引、`Intl.Segmenter` 分词、HTML 图片内嵌、导出模板系统、BYOK 联网。
- `PAPER-WIDTH-001` 解冻、`classify/mergeQuestionOrder/alignNativeWithRegistry/collectAllTurns/scrollToStoredQuestion` 算法本体不动（只复用调用；`buildMarkdown/buildExport/cleanTurnText` 渲染/文本层与新增备份/HTML函数除外）。
- 不新增 host 权限/远程 fetch；`docs/known-issues.md` 结论不改写（只可追加）；版本号保持 `0.3.3`（收官兼容增强不 bump，诊断三处一致）。

## 四、前置条件

- Phase-3 已验收：勾选导 MD + front-matter + 代码围栏 + `DOCDEEP_EXPORT.onlySelected` 透传有效；`qOrder/qInfo` 全集 + `scrollToStoredQuestion` 单例有效；schema v2 + 收藏管理有效。
- Chrome 109+ 可加载目录；popup 非 DeepSeek 页可打开（历史/搜索仅提示，不崩）。

## 五、代码影响范围（白名单）

- 允许：`content.js`（`DEFAULTS` 加 3 键、`onChanged` 加 3 键、备份状态 `lastBackupAt/lastBackupHash` + `maybeBackup` + 定时器 + `heartbeat` 钩子 + `snapshot.backup` 可选字段 + `escapeHtml/buildHtml` + `buildExport` html 分支 + `fallbackDownload` html 分支 + 工具条“导出 HTML”按钮 + `DOCDEEP_EXPORT` format 路由补 `html` + `setOn(false)/urlChanged` 选中态清理沿用）、`background.js`（仅加 `html` mime/扩展名分支，`safeFilename`/空串逻辑不动）、`popup.html/js`（`DEFAULTS` 加 3 键 + 备份设置行 + 历史时间线卡 + 全局搜索卡 + 导出 HTML 按钮 + 诊断/报告备份字段 + `HISTORY_*` 常量与 `normalizeHistoryEntry/migrateHistory/pruneHistory/buildGlobalIndex/filterGlobalIndex` 纯函数 + `module.exports` 扩展）、`docs/*`（含 `AGENTS.md` 设置键数/架构行同步）。
- 禁止：`manifest.json` 权限/host、`content.css`（本 Phase 无新浮层，工具条复用现有按钮样式）、`content.js:classify/mergeQuestionOrder/alignNativeWithRegistry/collectAllTurns/scrollToStoredQuestion` 本体、`docs/known-issues.md` 改写。

## 六、任务拆解

### Task 1 开发A（主代理串行，先 content.js）

目标：备份生产端 + HTML 生成端可用，不抢滚动，默认关闭。

涉及文件：仅 `content.js`。

实施内容：
1. 设置键：`DEFAULTS` 加 `docdeep_backup:false, docdeep_backup_mins:10, docdeep_backup_keep:10`；`onChanged` 监听数组追加三键（增量 `applySettings + classify()`，不重置 `qOrder`）；`snapshot()` 加可选 `backup:{on,lastAt}`（老 popup 忽略，新 popup 选读）。
2. 备份状态：顶层 `lastBackupAt=0, lastBackupHash=''`；常量 `HISTORY_KEY='docdeep_history_v1', HISTORY_HARD_MAX=20, MD_MAX=20000`；`setOn(false)` 重置 `lastBackupHash=''`（保留 `lastBackupAt` 做节流；与 `qOrder` 清空语义一致，重开即重新累积）。
3. `maybeBackup(force=false)`（async，内部 try/catch 永不抛）：
   - 守卫：`!isOn()` 返；`settings.docdeep_backup!==true` 返；`exportState||outlineComplete` 返（与采集/补全互斥）；间隔 `mins=clamp(1..60)` 未到返。
   - 采集：只读当前已挂载（`collectVisibleTurns` 新 Map，不调用 `collectAllTurns`，零滚动）；空返。
   - 指纹：`hash=hashText(key+text.length 串 + document.title)`；与 `lastBackupHash` 相同则更新 `lastBackupAt=now` 后返（仅变化才写，兼做节流）。
   - 组装：`title=exportTitle(), url=location.href, turns=records.length, questions=qOrder.length, md=buildMarkdown(...,{qNumberOf})` 截断 20000（记 `chars` 全长 + `truncated`），`qFirsts=qOrder.slice(0,50).map(qInfo首句80字)`；读库→按 `id=url` upsert（保留 `createdAt`）→倒序→截断 `min(keep≤20)`→写库；配额失败降级：重试元数据版（`md:'',qFirsts:[]`，保留计数）→再失败逐半裁剪→仍失败 `console.warn` 收场；成功才更新 `lastBackupHash`，`lastBackupAt` 在尝试时即更新（防热循环）。
4. 触发：启动后 `setInterval(60s)` 调 `maybeBackup()`（守卫内敛，无需清理，关扩展即随页面上下文结束）；`heartbeat()` 末尾加 `try{maybeBackup()}catch{}`（不 await，不阻塞心跳落盘）。
5. HTML：`escapeHtml` + `buildHtml(records,title,opts)`（`<!doctype html>` 单文件：`<meta charset>` + 内联 `<style>` 纸面/代码暗色/引用/表格最小集 + 头部标题/url/时间/selection + 正文 `##→h2/```围栏→pre/---→hr/段落→p` 全转义，无外链、无远端图片）；`buildExport` 加 `html` 分支（JSON 分支不动）；`fallbackDownload` 加 `html:text/html/.html`。
6. 入口：工具条加 `导出 HTML` 按钮（`type=button`，复用现有工具条样式，点 `exportConversation('html')`）；`onMessage.DOCDEEP_EXPORT` format 路由补 `html`（现 `json?json:md` 会把 html 吞成 md，属必须修）。

验收标准：默认关时零写入；开后 60s 内出现首条快照且内容变化才增写；导出/补全运行时备份跳过；HTML 双链路（background 正常 + 禁用 background 时 blob fallback）均落 `.html` 文件；`node --check` 通过。

风险：`storage.local` 5MB 配额（以降级链解决）；页面闲置无 mutation 时心跳不跑（以 60s 独立定时器兜底）；`setInterval` 常驻仅读守卫，开销可忽略。

### Task 2 开发B（主代理串行，后 popup.* + background.js）

目标：备份消费端 + 全局搜索可用，280px 不撑高，非 DeepSeek 页不崩。

涉及文件：`popup.html/js`、`background.js`。禁止碰 `content.js/css`。

实施内容：
1. `background.js`：mime/扩展名加 `html:text/html/.html` 分支；其余（`safeFilename`、空串、回调）逐行不动。
2. `popup.js`：
   - `DEFAULTS` 加 3 键（共 9 键）；`HISTORY_KEY/HISTORY_HARD_MAX=20` 常量；`paint()` 同步备份开关/间隔/条数；备份三控件接线（`set + notify DOCDEEP_SETTINGS`，失败降级，仿 `ol/keys`）；`load()` 合并（`{...DEFAULTS,...stored}` 老配置有效）。
   - 纯函数（Node 可测）：`normalizeHistoryEntry/migrateHistory(prune含去重保序)/pruneHistory(list,keep)`、`buildGlobalIndex(bookmarks,history)/filterGlobalIndex(index,q)`（hay=标题+tag+url+Q首句小写；结果含 `hitSnippet` 首命中 Q 句/标题；按 `updatedAt` 倒序；空输入返空数组永不抛）。
   - 历史：`loadHistory/renderHistory`（倒序、打开/删除/导出单条，`chrome.tabs.create`/存储重写/`DOCDEEP_DOWNLOAD md` + blob fallback，人话空状态/配额提示）；删除/导出后重渲染 + 预热搜索索引。
   - 搜索：`#global-search` 输入防抖 150ms 渲染 `filterGlobalIndex`（索引惰性构建 + `setTimeout` 预热，不阻塞打开；无数据/无匹配人话）。
   - 导出 HTML 按钮 `#export-html(type=button)` → `sendPage({DOCDEEP_EXPORT,format:'html'})` 人话提示。
   - `buildBookmarksExport` settings 段纳入 9 键（老文件无该段仍可导入，导入只读 bookmarks 段）；诊断 `check` 加备份行（`stored.docdeep_backup` + 历史条数 + 快照 `backup?.on` 选读）；报告 settings 加 `backup` 三键（`??` 缺省）。
   - `module.exports` 追加新纯函数与常量；DOM 接线守卫沿用（Node 下不执行）。
3. `popup.html`：新增“历史备份”卡（备份开关行 + 间隔/条数 select + `#history-list` 内滚动）与“全局搜索”卡（`#global-search[type=search,aria-label]` + `#global-results` 内滚动）；导出行加 `#export-html`；内联 `<style>` 加两列表样式（复用 `.bookmark-*` 观感，`max-height` 内滚动）；所有新按钮 `type="button"`、输入 `aria-label`、空状态人话。

验收标准：开备份后 popup 时间线出现条目且倒序；打开/删除/导出单条可用；全局搜标题/Q首句/tag 命中且按更新倒序；备份关时历史只读不增写；非 DeepSeek 页全控件可点不崩；`node --check` 通过。

风险：popup 280px 拥挤（以两卡内滚动解决）；历史与书签 tag 联动（以 url 关联取 tag，取不到记“备份”来源）。

### Task 3 测试（主代理自测，只读+临时夹具，不改业务）

实施内容：Node 纯函数（备份归一化/迁移/裁剪/索引过滤：空/非法/超长/脏URL/去重/截断/大小写/倒序/空快照）+ HTML（转义/围栏/标题/空记录/front-matter selection）+ 往返无退化（书签导入导出/Phase-2/3 关键函数存在）；结构走读（双端 9 键一致、onChanged 9 键、定时器60s、心跳钩子、互斥、降级链、mime 三分支、format 路由、INJECTED/aria/type、CSS 零改、权限零改）；回归 Phase-1/2/3 + 原回归。

验收标准：矩阵（用例/预期/实际/通过），失败阻断，声明无实机局限。

### Task 4 Review（主代理只读 diff）

放行门：可摘除（本 Phase content 无新浮层；popup 无注入）、存储兼容（新键默认关、老配置有效、历史迁移幂等、配额降级）、消息兼容（EXPORT format/onlySelected 可选、DOWNLOAD html 新增）、CSS 零改确认、快捷键零新增确认、单例复用（采集/滚动无第二套）、白名单外修改、三处版本一致。输出放行/打回（带行号）。

## 七、测试计划

- 新功能：备份默认关零写/开后首条/变化才写/间隔节流/保留条数裁剪/20000截断/配额降级元数据/时间线倒序/打开删除导出单条/全局搜三源命中/大小写/倒序/空状态/HTML转义围栏双链路/format路由。
- 边界：空会话、单Q、100Q、`qOrder` 空、历史脏数据、非法URL、存储抛错、非DeepSeek页、老配置无三键（默认关）、老快照无backup字段。

## 八、回归测试范围

Phase-1（收藏搜索/筛选/改名/导入导出往返/大纲过滤/无匹配/M/N）+ Phase-2（J/K/边界/互斥/总闸/?/Esc/补全三态/取消/恢复位）+ Phase-3（勾选/全选清空仅看/选中导出原号/front-matter/围栏）+ 原回归（开关恢复原站/字号/主题/大纲开关/复制/导出MD+JSON含取消/打印/查找↑↓/诊断版本一致/侧栏过滤/收藏打开删除/流式无重复/滚动无卡顿）。

## 九、完成定义 Definition of Done

- 白名单 diff 可 Review，无 console 报错（探针/备份 try/catch 吞错除外）；测试+Review 放行；失败记报告并阻塞。
- `docs/功能扩展规划.md` 功能 3/4/6 更新为 Phase-4 记录；完成报告基于真实 diff；`AGENTS.md` 键数/架构行同步。
- 默认不打扰（备份关、搜索空、HTML 与 MD 共存）；空/忙/配额/边界均有人话；popup 280px 不撑高。

## 十、进入下一阶段的条件

- 本 Phase 即路线图最后一环：完成后整轮目标（3/4/5/6/9/10）全部收官，无 Phase-5。
- Task1-4 完成并整合，无冲突、无白名单外修改；已汇报并等待验收；用户验收前不做收官之外的改动。
