# Phase 2 工单计划（效率流：键盘导航 J/K/? + 大纲一键补全）

## 一、阶段目标

交付键盘效率流与大纲补全闭环：`J/K` 按 `qOrder` 全局顺序跳转 Q（含未挂载自动定向定位）、`?` 帮助浮层、`docdeep_keys` 总闸（默认开）、大纲一键补全按钮（全量爬取 + 取消 + 与导出/定位互斥）。Phase-1 的过滤/M/N/收藏管理保持可用。不做 `o` 折叠、`/` 聚焦、`Alt+K` 命令面板（延后 Phase-3/4 或按需）。

## 二、本阶段涉及的功能

- 功能 9 部分：仅 `J/K + ?帮助 + 总闸`。`o`、`/`、`Alt+K` 明确不做。
- 功能 5 收尾：一键补全按钮（Phase-1 预留接口落地）。
- 地基：新增设置键 `docdeep_keys`（默认 `true`），进双端 `DEFAULTS` + `onChanged` + popup 开关行。

## 三、本阶段不处理的内容

- 功能 3（选择性导出）、功能 4（自动备份）、功能 6（全局搜索）、功能 10 剩余高级管理。
- `PAPER-WIDTH-001` 解冻、`background.js` 下载链路、`classify/mergeQuestionOrder/collectAllTurns` 算法本体不动（只复用调用）。
- 不新增 host 权限/远程 fetch；版本号保持 `0.3.1`（兼容增强不 bump）。
- 不改 `docs/known-issues.md` 结论（只可追加）。

## 四、前置条件

- Phase-1 已验收：`popup.js` schema v2 + 过滤渲染、`content.js` 过滤框 + 签名 `|f:` + `olReg` 全量约定有效。
- Chrome 109+ 可加载目录；popup 非 DeepSeek 页可打开。

## 五、代码影响范围（白名单）

- 允许：`content.js`（`DEFAULTS` 加键、`keydown` 扩展、新增 `getCurrentQIndex/jumpQ/toggleKeysHelp/completeOutline`  helper、`ensureOutlineShell` 加补全按钮、`setOn(false)` 摘除确认）、`content.css`（帮助浮层 + 补全按钮 + `mo` 分支）、`popup.html/js`（`DEFAULTS` 加键 + 键盘开关行 + 设置接线 + 诊断报告 settings 显示）。
- 禁止：`manifest.json` 权限、`background.js`、`content.js:classify/mergeQuestionOrder/collectAllTurns/scrollToStoredQuestion` 本体逻辑、`content.css` 纸宽祖先规则、`docs/known-issues.md` 改写。

## 六、任务拆解

### Task 1 开发（子代理A，一人串行写 content.* + popup.*，避免同文件冲突）

目标：键盘 + 补全可用，可摘除，默认不打扰。

负责代理：功能开发代理。

涉及文件：`content.js`、`content.css`、`popup.html`、`popup.js`。禁止改白名单外。

实施内容：
1. 设置键：双端 `DEFAULTS` 加 `docdeep_keys: true`；`content.js:applySettings` 合并后无需特殊处理（读 `settings.docdeep_keys !== false`）；`chrome.storage.onChanged` 监听数组加 `'docdeep_keys'`；`popup.html` 设置卡加一行 `<label>键盘导航（J/K/?）</label><button class=sw id=keys>`；`popup.js` `paint()` 同步、`load()` 合并、点击接线（`set + notify DOCDEEP_SETTINGS`，失败降级提示，仿照 `ol` 开关）；诊断报告 `settings` 段加 `keys` 显示（可选字段读取，兼容老快照）。
2. 键盘：`content.js:keydown` 顶部守卫保持（`defaultPrevented/isEditableTarget` 即返）；旧三键（`Ctrl+Shift+F / Alt+Shift+D/C`）保持常开不受总闸影响；新增分支仅当 `isOn() && settings.docdeep_keys !== false`：
   - `key==='j'` → `jumpQ(1)`；`key==='k'` → `jumpQ(-1)`（无修饰键时；有 `ctrl/meta/alt` 即忽略，避免劫持浏览器键）。
   - `key==='?'`（即 `shift+/`）→ `toggleKeysHelp()`（`preventDefault`）。
   - `Escape` 仅当帮助开时关闭（避免抢原站 Esc）。
3. `getCurrentQIndex()`：复用 `spy` 口径（`qOrder` 顺序 + `liveElByKey.getBoundingClientRect().top <= 140` 取最后命中；无命中则按 `scrollTop<=2 → -1` 即将从头开始，否则按首个挂载 index-1 兜底；`qOrder` 为空返回 -1）。
4. `jumpQ(step)`：边界处理（首/尾 toast“已是首个/末个提问”）；`qOrder` 为空 toast“暂无大纲，先滚动加载”；若 `exportState` 或补全运行中 toast 忙；目标 live 且 connected → `scrollIntoView({smooth,block:start})`；否则复用单例 `scrollToStoredQuestion(key)`（禁止另写第二套滚动；调用前 `outlineSearchToken` 语义由被调函数处理）。
5. 帮助浮层：`toggleKeysHelp()` 创建/切换 `div#docdeep-keys-help.docdeep-injected`（`position:fixed` 右下或居中，`z-index 2147483000` 系，内容：J/K/?/Esc + 旧三键说明 + “输入框内禁用”），点击外部/按 Esc/? 关闭；`setOn(false)` 随 `.docdeep-injected` 自动摘除（需验证）。
6. 一键补全：`ensureOutlineShell` 在过滤框下、列表上插入 `button.doc-ol-complete(type=button, INJECTED)`；文案由 `buildOutline` 每次更新：`已全部加载（N)` 时 `disabled` 置灰，否则 `补全未加载（M/N）`（M=`qOrder.length`，N=`native.count`；无原生时显示 `滚动补全全部`）；点击运行 `completeOutline()`：
   - 互斥：`exportState` 存在即 toast 并返；启动时 `outlineSearchToken++` 取消 pending 定位；设 `outlineComplete={cancelled:false}` 独立令牌（禁止复用 `exportState` 对象），运行中按钮变“补全中…点击取消”，再点则 `cancelled=true`。
   - 爬取：记 `initialTop`；`scrollToExact(container,0) → wait → classify()`；按 `viewport*0.8` 步进到底，每步 `wait(130)+classify()`，每 2 步更新按钮文案 `补全中 M/约N…`；到底后稳定 2 轮（`records` 口径改为 `qOrder.length` 无增长）即停；`finally` 回到 `initialTop + wait(40)`，按钮恢复，`buildOutline()` 重绘。
   - 全程 `try/finally` 清令牌；取消/toast 人话（“补全已取消”“补全完成，共 N 个提问”）。
7. CSS：`.doc-ol-complete`（块级、全宽、圆角）+ `:disabled` 置灰 + `mo` 分支；`#docdeep-keys-help`（浮层、标题、kbd 样式）+ `mo` 分支；全部 `html[data-docdeep="on"]` 开头；打印时帮助/补全随大纲隐藏（大纲已在 `@media print` 隐藏，无需单列，但需确认）。

验收标准：
- 输入框/textarea 内按 J/K/? 无反应；开关关闭时 J/K 无反应；总闸关后 J/K/? 无反应但旧三键仍可用。
- 长会话首屏按 J 逐个下跳、按 K 回跳，未挂载目标自动定位且编号不抖；首/尾边界 toast；空大纲 toast。
- 补全：50 问只挂载 12 问时按钮显示 `补全未加载（12/50）`，点击自动爬完变禁用，取消可停，导出中点击给忙提示，结束后回到原滚动位。
- `node --check` 三 JS 通过；关闭扩展后帮助/补全/过滤框摘除干净。

风险：自动滚动与用户手动滚动打架（以取消令牌 + 互斥解决）；虚拟列表 `scrollHeight` 抖动导致死循环（设 320 步上限 + 稳定 2 轮退出，抄 `collectAllTurns` 模式）。

### Task 2 测试（子代理B，只读+临时夹具）

目标：独立验证 + 回归表。

负责代理：测试代理。禁止改业务代码。

实施内容：
- Node：`DEFAULTS` 含 `docdeep_keys` 双端一致；`getCurrentQIndex/jumpQ` 边界纯逻辑仿真（空/首/尾/单条）；导入往返仍一致（Phase-1 无退化）。
- 夹具/DOM 走读：`keydown` 守卫（editable/修饰键/总闸/旧键豁免）、帮助 `INJECTED` + `aria` + Esc 关闭、`complete` 按钮文案三态（无原生/有缺口/已全）+ `disabled`、取消令牌与 `exportState` 互斥、`finally` 恢复滚动。
- 回归：Phase-1 收藏搜索/导入导出/大纲过滤/M/N + 原回归（开关/字号/主题/复制/导出/打印/查找/诊断/侧栏/收藏打开删除/流式/闪烁）。

验收标准：矩阵（用例/预期/实际/通过），失败阻断，声明无实机局限。

### Task 3 Review（子代理C，只读 diff）

目标：放行门。查可摘除、存储兼容（新键默认开、老配置有效）、消息兼容（`DOCDEEP_SETTINGS` 含新键）、CSS 前缀/mo/打印、快捷键冲突、重复滚动实现（必须单例）、白名单外修改。输出放行/打回（带行号）。

## 七、测试计划

- 新功能：J/K 上下跳（含跨未挂载）、首尾边界、空大纲、导出/补全忙互斥、总闸开/关、输入框禁用、?帮助开/关/Esc、补全三态文案/取消/恢复位、无原生时补全文案。
- 边界：`qOrder` 空、`liveElByKey` 空、单 Q、100 Q 上限渲染、老配置无 `docdeep_keys`（应默认开）、存储写失败降级、非 DeepSeek 页 popup 开关可点。

## 八、回归测试范围

Phase-1 全量（收藏搜索/筛选/改名/导入导出往返/大纲过滤/无匹配/M/N）+ 原回归（开关恢复原站/字号/主题/大纲开关/复制/导出MD+JSON含取消/打印/查找↑↓/诊断版本一致/侧栏过滤/收藏打开删除/流式无重复/滚动无卡顿）。

## 九、完成定义 Definition of Done

- 白名单 diff 可 Review，无 console 报错；测试+Review 放行；失败记报告并阻塞。
- `docs/功能扩展规划.md` 功能 5/9 更新为 Phase-2 记录；完成报告基于真实 diff。
- `setOn(false)` 后帮助/补全/过滤框摘除；popup 280px 不撑高；空/忙/边界均有人话。

## 十、进入下一阶段的条件

- Task1-3 完成并整合，无冲突、无白名单外修改。
- 已汇报并等待验收；用户未说“验收通过/可以继续/开始下一阶段”前不得动 Phase-3 代码。
