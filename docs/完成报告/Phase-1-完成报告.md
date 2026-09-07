# Phase 1 完成报告（地基：收藏管理MVP + 大纲过滤MVP + 存储schema v2）

## 一、阶段目标回顾

按 `docs/工单计划/Phase-1.md`：交付收藏搜索/过滤/重命名/导入导出 + 大纲过滤框 + M/N 常显 + `docdeep_schema_ver=2` 迁移，不碰备份定时器/一键补全/键盘/选择性导出/全局全文索引。每阶段结束可运行，无 breaking change，版本号保持 0.3.1。

## 二、已完成任务

- Task 1 架构分析（子代理A，只读）：输出 schema v2 + 过滤接口约定 + Phase-2/3 预留（`Set<key>`/定位单例）。
- Task 2 存储+收藏管理（子代理B）：仅改 `popup.html/popup.js`。
- Task 3 大纲过滤+M/N常显（子代理C）：仅改 `content.js` 大纲壳 + `content.css`。
- Task 4 测试（子代理D）：80 断言全过（纯函数 62 + 大纲 14 + 回归走读 18，含主代理复核 9）。
- Task 5 Review（子代理E）：放行，5 条非阻断建议中 1 条已整合（排序），余 4 条记入遗留。
- 主代理整合：Review 排序修复 + 语法/单测复核 + 本报告 + 规划文档更新。

## 三、实际修改内容

- 收藏存储模型升级：`SCHEMA_VER=2` + `migrateBookmarks/filterBookmarks/parseImportBookmarks/buildBookmarksExport/exportBookmarks/renameBookmark/getTagOptions/persistBookmarks/handleImportFile`，导入合并策略“导入优先、旧其余保序追加、截断100”，写失败降级人话。
- popup UI：搜索框 `#bookmark-search`、筛选 `#bookmark-tag-filter（全部/未分类/动态tag）`、导出 `#bookmark-export`、导入 `#bookmark-import[type=file]`，每行加改名按钮，空状态区分暂无收藏/无匹配。
- 大纲：`ensureOutlineShell` 插入 `input.doc-ol-filter(type=search, INJECTED, 防抖150ms, stopPropagation)`；`buildOutline` 过滤显示层（Q查label+title，h查label）、空显“无匹配”、签名追加 `|f:filter`、`olReg` 保持全量、`spy` 跳过隐藏项；M/N 头逻辑原样保留并常显化。
- CSS：`.doc-ol-filter` + `mo` 墨色分支（全 `html[data-docdeep="on"]` 前缀）。

## 四、新增文件

- `AGENTS.md`（代理行为约束，17 节）
- `docs/功能扩展规划.md`（6 功能长期真相源）
- `docs/工单计划/Phase-1.md`（本阶段工单）
- `docs/完成报告/Phase-1-完成报告.md`（本文件）
- 无新增业务代码文件（刻意不新增 `search.js` 等，保持 Phase-1 最小）。

## 五、修改文件

- `popup.js`：278 行 → 600 行（新增存储/UI逻辑，`node --check` 通过；`POPUP_VER` 未动）。
- `popup.html`：64 行 → 68 行（收藏卡片区新增 4 控件，沿用 `.card/.row/.btns`，列表仍内滚动）。
- `content.js`：1351 行 → 1392 行（仅大纲壳段，算法冻结，`node --check` 通过）。
- `content.css`：411 行 → 420 行（仅大纲过滤框 9 行）。
- 未动：`manifest.json`、`background.js`、`docs/known-issues.md`（结论未改写）。

## 六、关键实现说明

- 迁移幂等：`migrateBookmarks` 复用 `normalizeBookmarks` 内核，老数组/`{bookmarks}`包装/脏条全容错；`loadBookmarks` 读版本后 `ver!==2` 回写，主代理追加 `.sort(updatedAt倒序)` 保首屏有序。
- 导入永不丢数据：`parseImport` 失败返回 `ok:false` 由调用方保留旧收藏；`handleImportFile` 报“成功 X 跳过 Y”。
- 导出复用下载链：popup 发 `{type:DOCDEEP_DOWNLOAD, format:json, filename:base(去.json), content}`，后台补 `.json`，失败走 Blob fallback。
- 大纲零算法改动：`mergeQuestionOrder/alignNative/collect/scrollToStored` 本体未动；过滤仅 `display:none` + 签名区分，避免 OUTLINE-ORDER-001 重演。
- Node 单测守卫：`module.exports` + `if(document&&chrome.storage)` 接线守卫，保证 `require` 不崩。

## 七、测试结果

- 子代理D：62 项纯函数（空/非法/超长tag24/脏URL/老缺字段/101截断/文件内去重/往返一致/合并导入优先/非DeepSeek不崩）全过；14 项大纲（类/占位/aria/防抖/stopPropagation/签名/无匹配/全量olReg/M-N/items<2/CSS前缀+mo）全过。夹具在系统临时目录，未进仓库。
- 主代理复核：`node --check` 三文件 OK；`require(popup.js)` 9 断言（normalize/截断/过滤/导出文件名/往返/坏JSON/schema2）全过；排序修复后 `PASS:sort`。

## 八、回归测试结果

18/18 通过（代码走读级，未实机，已声明局限）：开关启停、字号/主题/大纲开关、复制全文、导出MD/JSON（含取消）、打印样式、查找↑↓、诊断版本一致（`0.3.1` 三处）、侧栏过滤、收藏打开/删除、流式无重复、无大纲闪烁。需 Chrome 人工补测：长会话+流式中+回到顶部编号稳定、剪贴板/打印预览/滚动性能。

## 九、发现的问题

- 无阻断项。Review 非阻断 5 条中 4 条未改（见遗留），1 条已改（排序）。

## 十、遗留问题

1. `inp._olT` 在 `setOn(false)` 未 `clearTimeout`（摘除后 150ms 空触发一次，首行 `isOn()` 即返，无泄漏，可 Phase-2 顺手清）。
2. 过滤 keystroke 仍跑 `updateQuestionRegistry+renumber` 对账，可 Phase-2 加“纯过滤跳过对账”省性能。
3. 存量 `popup.html` 按钮仅新按钮显式 `type=button`，老按钮无 form 故无风险，Phase-2 可全量补齐。
4. 侧栏过滤仅 `a` 标签（现状），全局搜索 Phase-4 再扩。
5. 人工实机回归未做（无浏览器环境），需用户侧加载验证。

## 十一、与原工单的差异

- 仅一处增强：主代理据 Review 意见在 `loadBookmarks` 加 `.sort(updatedAt倒序)`（工单要求倒序，子代理实现依赖插入序，属补齐非变更）。
- 其余与工单一致；版本号按工单保持 0.3.1 未 bump；HTML 导出、补全按钮、键盘、备份均未提前做。

## 十二、功能状态变化

- 功能 10：`待实施` → `进行中`（MVP 已交付：搜索+筛选+改名+导入导出+schema v2；排序/备份/高级管理待后续 Phase）。
- 功能 5：`待实施` → `进行中`（MVP 已交付：过滤+ M/N 常显；一键补全待 Phase-2）。
- 功能 3/4/6/9：仍 `待实施`，分别归属 Phase-3/4/4/2（见规划文档路线图）。

## 十三、下一阶段建议

按规划进 Phase-2（9 的 J/K/? + 5 一键补全按钮），复用本 Phase `scrollToStoredQuestion` 单例与 `olReg` 全量约定。进入前需用户验收本 Phase；建议用户实机验证：收藏导入导出往返、大纲过滤、无匹配文案、墨色主题、诊断版本一致。

## 十四、等待用户验收

**状态：等待用户验收 Phase 1。** 未获“验收通过/可以继续/开始下一阶段”前，不动 Phase-2 代码。
