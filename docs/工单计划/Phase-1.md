# Phase 1 工单计划（地基：收藏管理MVP + 大纲过滤MVP + 存储schema v2）

## 一、阶段目标

交付可运行的 Phase-1：收藏搜索/过滤/重命名/导入导出 + 大纲过滤框 + M/N 常显 + `docdeep_schema_ver=2` 迁移。不碰自动备份定时器、不碰一键补全滚动、不碰键盘/选择性导出/全局全文索引。为 Phase-2/3 预留 `SelectionService/定位单例` 接口约定。

## 二、本阶段涉及的功能

- 功能 10-MVP：搜索框 + tag 下拉过滤 + 重命名 + 导入/导出 JSON（含设置备份段）。
- 功能 5-MVP：大纲过滤框 + M/N 常显化（算法不动）。
- 地基：`docdeep_schema_ver` + `migrateBookmarks()` 幂等迁移 + 配额降级提示。
- 文档：`AGENTS.md`、`docs/功能扩展规划.md` 已建，本工单 + 完工后报告。

## 三、本阶段不处理的内容

- 功能 5 一键补全按钮（Phase-2）、功能 9（Phase-2）、功能 3（Phase-3）、功能 4/6 全量（Phase-4）。
- `PAPER-WIDTH-001` 解冻、`background.js` 下载链路、`classify` 指纹核心、`collectAllTurns` 采集循环均不动。
- 不新增 host 权限、不新增远程 fetch、不做 BYOK。
- 版本号保持 `0.3.1`（行为兼容增强，无 breaking change，不 bump；若 Review 坚持 bump 则在报告说明）。

## 四、前置条件

- 工作区非 git 仓库，无需 commit；开工前确认 `popup.js/html/content.js/content.css` 与 v0.3.1 一致。
- Chrome 109+ 可加载未打包扩展；popup 在非 DeepSeek 页可打开（仅提示）。

## 五、代码影响范围（白名单）

- 允许：`popup.html`（收藏卡片区 + 运行状态不动）、`popup.js`（存储/渲染/导入导出）、`content.js` 仅 `ensureOutlineShell/buildOutline` 渲染层 + 大纲 CSS 相关、`content.css` 仅大纲过滤框样式、`docs/*`、`AGENTS.md`。
- 禁止：`manifest.json` 权限、`background.js`、`content.js:classify/mergeQuestionOrder/collectAllTurns/scrollToStoredQuestion` 本体、`content.css` 纸宽祖先规则、`docs/known-issues.md` 改写结论（只可追加）。

## 六、任务拆解

### Task 1 架构分析（子代理A，只读）

目标：给出 schema v2 + 过滤接口约定，供 Task 2/3 直接照做，避免返工。

负责代理：架构分析代理（explore/general，只读，不写代码）。

涉及文件：只读 `popup.js/content.js/docs/known-issues.md`。

实施内容：
- 确认 `normalizeBookmarks` 现状缺口（无 schema 版本、无导入解析、无过滤、无重命名时间更新）。
- 设计 `SCHEMA_VER=2`、`migrateBookmarks(stored)`（输入未知结构→输出标准数组，幂等）、`filterBookmarks(list,{q,tag})`、`parseImportBookmarks(text)`（JSON.parse 失败/非数组/脏 URL 的处理）。
- 确认大纲过滤显示策略：`olReg` 保持全量，渲染层按过滤词隐藏；签名纳入过滤词；M/N 显示复用现有 `box.dataset.nativeTotal/Matched + head.textContent`。
- 输出 Phase-2/3 预留：`SelectionService = Set<key>`、`scrollToStoredQuestion` 单例复用声明。

验收标准：输出含字段清单 + 函数签名 + 边界表，主代理确认后 Task 2/3 开工。

风险：低（只读）。

### Task 2 存储+收藏管理（子代理B，写代码）

目标：popup 收藏管理 MVP 可用。

负责代理：功能开发代理（后端/存储向）。

涉及文件：仅 `popup.html/popup.js`。禁止改 `content.js/css/background.js/manifest.json`。

实施内容：
- `popup.js` 新增：`SCHEMA_VER=2`、`SCHEMA_KEY='docdeep_schema_ver'`、`migrateBookmarks()`、`filterBookmarks()`、`parseImportBookmarks()`、`exportBookmarks()`（含 settings 段）、`renameBookmark(id,newTitle)`；`loadBookmarks()` 先读版本再迁移再渲染；写失败 `try/catch` 提示。
- `renderBookmarks(filter)` 支持 `q/tag` 过滤 + 空状态“无匹配，换个关键词试试”；每行加“改名”按钮；列表保持 `updatedAt` 倒序。
- `popup.html` 收藏卡片加：搜索 input（`aria-label=搜索收藏`）、tag select（全部/未分类/动态tag）、导入（`<input type=file accept=application/json>`）+ 导出按钮；沿用 `.card/.row/.btns` 样式，`type=button`。
- 导入流程：读文件→`parseImport`→去重保序（`id=url`，新文件优先还是旧优先需明确并写进代码注释）→`storage.set`→重渲染→`tip` 报“成功 X 条，跳过 Y 条”。

验收标准：
- 老版本数组（无 `createdAt`、超长 tag、无 id）打开 popup 自动迁移且不丢数据。
- 导出→清空→导入→一致（往返测试）。
- 非法 JSON/非数组/全脏 URL 导入不清空旧数据并给人话提示。
- Node 可跑纯函数单测（`normalize/migrate/filter/parseImport`），附自测输出。

风险：popup 280px 拥挤需内滚动；文件名中文需 `safeFilename` 风格清洗（popup 侧简单实现）。

### Task 3 大纲过滤+M/N常显（子代理C，写代码）

目标：大纲可用性 MVP，不动算法。

负责代理：前端代理（内容脚本向）。

涉及文件：仅 `content.js`（`ensureOutlineShell/buildOutline` 段）+ `content.css`（大纲过滤框 + mo 主题）。禁止改 `popup.*`、`background.js`、`classify/merge/collect`。

实施内容：
- `ensureOutlineShell()` 的 `h4` 下插入过滤 input（`class=doc-ol-filter + INJECTED`，`placeholder=过滤大纲…`，`aria-label`），输入防抖 150ms 触发 `buildOutline()`；关闭（`setOn(false)`）时随大纲摘除。
- `buildOutline()`：读取过滤词（小写trim）；`items` 生成后先算 M/N 头（复用现有 `probeNativeOutline/align` 逻辑，保证无原生时仍显示 `本文大纲`）；再按过滤词过滤 `items`（Q 查 `label+title`，h 查 `label`）；空结果时 `list` 显示“无匹配” div 而非空；签名 `signature += '|f:'+filter`。
- `content.css`：`.doc-ol-filter` 样式（宽100%、圆角、边框），`mo` 主题分支；规则必须以 `html[data-docdeep="on"]` 开头。
- 保持 `olReg` 全量（供 spy/后续选中复用），仅显示层隐藏；`box.style.display` 逻辑不变（`items<2` 仍隐藏）。

验收标准：
- 长会话 + 流式中 + 回到顶部三场景编号不抖动（复用现有对账，不得改算法）。
- 过滤输入/清空即时生效；无匹配有人话；关闭扩展后过滤框摘除干净。
- 墨色主题下过滤框可读。

风险：过滤与签名/滚动高亮交互，需保证 `scheduleSpy` 不因隐藏按钮崩溃（跳过 `display:none` 项）。

### Task 4 测试（子代理D，测试向）

目标：独立验证 + 回归表。

负责代理：测试代理。

涉及文件：只读 + 允许新增临时夹具（用系统临时目录，不进仓库），禁止改业务代码。

实施内容：
- 对 Task 2 纯函数跑 Node 单测：空数组/非法输入/超长 tag/脏 URL/老版本缺字段/100+截断/导入往返。
- 对 Task 3 用最小 HTML 夹具验证大纲过滤/M/N/空状态/mo 类名存在（`grep` + DOM 断言思路）。
- 回归清单（见七/八）逐项打勾，失败即阻断并记入报告。

验收标准：输出测试矩阵（用例/预期/实际/通过与否），至少覆盖 2 个边界/Task。

风险：无浏览器时 DOM 只能夹具验证，需声明局限。

### Task 5 Review（子代理E，Review向）

目标：放行前最后一道门。

负责代理：Code Review 代理。

涉及文件：只读 diff。

实施内容：查可摘除原则、存储兼容、消息兼容、心跳字段兼容、性能（防抖/签名）、CSS 前缀、快捷键冲突（本 Phase 应无新增全局快捷键）、重复实现（过滤函数是否两处各写一份）。

验收标准：给出放行/打回意见，打回项必须带文件行号。

风险：低。

## 七、测试计划

- 新功能：收藏搜索（标题/tag/url 大小写）、tag 下拉动态生成、重命名空值回退、导出文件名、导入成功/部分成功/全失败、往返一致、大纲过滤命中/清空/无匹配、M/N 与诊断 `nativeOutline.count` 一致。
- 边界：空收藏、0/1 条大纲（应隐藏）、100+ 条截断、24 字 tag、非法 URL、`storage.set` 抛配额错、非 DeepSeek 页 popup 不崩、老版本无 `createdAt` 数据。

## 八、回归测试范围

开关启停恢复原站、字号/主题/大纲开关、复制全文、导出 MD/JSON（含取消）、打印样式、查找 ↑↓、诊断版本一致、侧栏过滤、收藏打开/删除、流式无按钮重复、无大纲闪烁、滚动 `classify` 无卡顿。

## 九、完成定义 Definition of Done

- 白名单内 diff 可 Review，无 `console` 报错（除已知探针 `try/catch` 吞错）。
- 上述测试+回归全过；失败项记入报告“发现的问题”并阻塞验收。
- `docs/功能扩展规划.md` 中功能 5/10 更新为 `进行中` + Phase-1 记录；完成报告已建且基于真实 diff。
- popup 280px 不撑高，空状态均有人话；`setOn(false)` 后注入节点（含过滤框）摘除干净。

## 十、进入下一阶段的条件

- 主代理已整合 Task 2/3、无文件冲突、无白名单外修改。
- 测试+Review 放行。
- 已向用户汇报并明确等待验收；用户未说“验收通过/可以继续/开始下一阶段”前不得动 Phase-2 代码。
