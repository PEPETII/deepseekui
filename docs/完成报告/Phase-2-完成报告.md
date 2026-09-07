# Phase 2 完成报告（效率流：键盘导航 J/K/? + 大纲一键补全）

## 一、阶段目标回顾

按 `docs/工单计划/Phase-2.md`：交付键盘效率流与大纲补全闭环：`J/K` 按 `qOrder` 全局顺序跳转（含未挂载自动定向定位）、`?` 帮助浮层、`docdeep_keys` 总闸（默认开）、大纲一键补全按钮（全量爬取 + 取消 + 与导出/定位互斥）。Phase-1 的过滤/M/N/收藏管理保持可用。不做 `o` 折叠、`/` 聚焦、`Alt+K` 命令面板。版本号保持 `0.3.1`。

## 二、已完成任务

- Task 1 开发：键盘 + 补全可用，可摘除，默认不打扰。
- Task 2 测试：Node 自测 + DOM 走读 + 回归表。
- Task 3 Review：白名单/兼容/可摘除放行门。
- 主代理整合：补齐缺口 + 自测复核 + 本报告 + 规划文档更新。

## 三、实际修改内容

- 本轮实际 diff（工作区非 git 仓库，按文件核对）：
  - `popup.js`：`DEFAULTS` 加 `docdeep_keys: true`（6 键）；`buildBookmarksExport` settings 加 `docdeep_keys`；`paint()` 同步 `keys` 开关；新增 `keys` 点击接线（set + notify DOCDEEP_SETTINGS，失败降级，仿照 ol）；诊断报告 settings 加 `keys: stored.docdeep_keys ?? true`；注释“5 键”改为“6 键”。`node --check` 通过。
  - `popup.html`：此前已含键盘开关行（`label#l-keys` + `button#keys.sw[type=button]`），本轮确认沿用，无需再改。
  - `content.js`：此前已含 Phase-2 主体（`DEFAULTS.docdeep_keys`、`keydown` J/K/?/Esc 分支、`getCurrentQIndex/jumpQ/toggleKeysHelp/completeOutline`、`ensureOutlineShell.ensureCompleteBtn`、`buildOutline` 三态文案、`setOn(false)` 取消补全令牌 + 摘除 mousedown 监听、`onChanged` 监听 `docdeep_keys`），本轮确认无缺口、无需再改。
  - `content.css`：新增 `.doc-ol-complete`（块级全宽圆角 + disabled 置灰 + mo 分支）与 `#docdeep-keys-help`（fixed 右下、z-index 2147483000 系、标题/kbd/tip/关闭按钮 + mo 分支）；`@media print` 追加 `#docdeep-keys-help`（补全按钮随大纲整体隐藏，无需单列）。
  - 未动：`manifest.json` 权限/host、`background.js`、`classify/mergeQuestionOrder/collectAllTurns/scrollToStoredQuestion` 本体、`content.css` 纸宽祖先规则、`docs/known-issues.md` 结论、版本号三处 `0.3.1`。
- 与工单差异：工单设想 Task1 由子代理串行写 content.* + popup.*；实际 content.js 主体与 popup.html 开关行已在工作区存在，主代理仅补齐 popup.js（DEFAULTS/paint/接线/诊断/注释）与 content.css（补全按钮/帮助浮层/mo/打印）缺口。行为与验收口径一致，无 breaking change。

## 四、新增文件

- `docs/工单计划/Phase-2.md`（本阶段工单，输入）
- `docs/完成报告/Phase-2-完成报告.md`（本文件）
- 无新增业务代码文件（刻意不新增模块，保持最小侵入；自测脚本放系统临时 scratchpad，未进仓库）。

## 五、修改文件

- `popup.js`：6 键 DEFAULTS + 导出/paint/接线/诊断（`node --check` 通过）。
- `content.css`：补全按钮 + 帮助浮层 + mo + 打印隐藏（全 `html[data-docdeep="on"]` 前缀）。
- 确认沿用（本轮未再改）：`content.js` Phase-2 主体、`popup.html` 键盘开关行。
- 未动：`manifest.json`、`background.js`、`docs/known-issues.md`（结论未改写）。

## 六、关键实现说明

- 总闸默认开：双端 `DEFAULTS.docdeep_keys: true`；content 读 `settings.docdeep_keys !== false`，老配置无该键默认开；`chrome.storage.onChanged` 监听数组含 `docdeep_keys`，增量 `applySettings + classify`，不重置 `qOrder`。
- 旧三键豁免：`Ctrl+Shift+F / Alt+Shift+D/C` 在 keydown 顶部处理，不受总闸影响；J/K/? 分支在其之后，先过 `ctrl/meta/alt` 忽略，再过 `isOn() && keys !== false`。
- 定位单例：`jumpQ` 目标 live 且 connected 则 `scrollIntoView`，否则复用 `scrollToStoredQuestion(key)`，无第二套滚动；`outlineSearchToken` 语义由被调函数处理；补全启动时 `outlineSearchToken++` 取消 pending 定位。
- 补全令牌独立：`outlineComplete={cancelled:false}` 独立于 `exportState`；运行中按钮“补全中…点击取消”，再点即取消；与 `exportState` 双向互斥，均给人话 toast；全程 `try/finally` 清令牌 + 回到 `initialTop` + `buildOutline` 重绘；320 步上限 + 底部稳定 2 轮退出，抄 `collectAllTurns` 模式。
- 可摘除：补全按钮与帮助浮层均带 `docdeep-injected`（帮助 `id=docdeep-keys-help` + `role=dialog` + `aria-label`），`setOn(false)` 随 `.docdeep-injected` 自动摘除，另显式取消补全令牌 + `removeEventListener(mousedown, keysHelpOutside)`；过滤框 `inp._olT` 遗留仍未清（见遗留）。
- 诊断兼容：报告 settings 新增 `keys` 为可选读取（`?? true`），老快照不崩。

## 七、测试结果

- `node --check` 三 JS（content/popup/background）通过。
- Node 自测 61 断言 ALL_PASS：双端 DEFAULTS 一致（6 键 + 默认 true）；老配置默认开；导出 settings 含 keys；空/首/尾/单条边界；导入往返一致；content 五函数存在；keydown 守卫（editable/旧三键/修饰键/总闸/J/K/?/Esc）；补全互斥/独立令牌/取消/finally/三态文案；INJECTED + aria + 外部点击；setOn 取消 + 摘除监听；onChanged 含新键；无第二套滚动；popup 接线 + 报告 keys + html 开关行；CSS 前缀/mo/disabled/kbd/打印/z-index/fixed；三处版本 `0.3.1`；权限未变。
- Phase-1 无退化抽查：`filterBookmarks` 中文命中 1 条；`migrateBookmarks` 老缺字段补齐 1 条。
- DOM 走读（代码级，未实机）：输入框内 J/K/? 无反应；总闸关后旧三键仍可用；长会话 J/K 跨未挂载走单例定位；首/尾/空大纲 toast；补全三态（无原生“滚动补全全部”/有缺口“M/N”/已全 disabled）；取消可停；导出中互斥；结束回原位；帮助 Esc/外部点击/? 关闭；关闭扩展后摘除干净。
- 局限声明：无浏览器实机环境，滚动/虚拟列表回收/流式中定位、剪贴板、打印预览需用户侧 Chrome 人工补测。

## 八、回归测试结果

- 走读级通过（未实机，已声明局限）：Phase-1 全量（收藏搜索/筛选/改名/导入导出往返/大纲过滤/无匹配/M/N）+ 原回归（开关恢复原站/字号/主题/大纲开关/复制/导出MD+JSON含取消/打印样式/查找↑↓/诊断版本一致/侧栏过滤/收藏打开删除/流式无重复/滚动无卡顿）。
- 需 Chrome 人工补测：50 问只挂载 12 问时补全 `12/50 → 爬完禁用`；长会话首屏 J 逐个下跳、K 回跳；流式中补全/定位互斥；墨色主题帮助/按钮配色；280px 面板不撑高。

## 九、发现的问题

- 无阻断项。Review 放行，3 条非阻断遗留记入第十节。

## 十、遗留问题

1. `inp._olT` 在 `setOn(false)` 未 `clearTimeout`（Phase-1 遗留，仍未清；摘除后空触发一次即返，无泄漏，可 Phase-3 顺手清）。
2. `buildOutline` 每次按键过滤仍跑 `updateQuestionRegistry+renumber` 对账，可后续加“纯过滤跳过对账”省性能（Phase-1 遗留）。
3. 人工实机回归未做（无浏览器环境），需用户侧加载验证（Phase-1 遗留延续）。

## 十一、与原工单的差异

- 仅一处执行差异：Task1 未起子代理重写 content.js/popup.html（主体已存在），主代理直接补齐 popup.js + content.css 缺口并全量自测/Review。行为、文件白名单、验收口径与工单一致；`o`/`/`/`Alt+K`、PAPER-WIDTH 解冻、background 下载链路、算法本体均未动；版本号保持 `0.3.1`。

## 十二、功能状态变化

- 功能 9：`待实施` → `已完成`（J/K/? + 总闸已交付；`o`/`/`/`Alt+K` 仍延后）。
- 功能 5：`进行中` → `已完成`（过滤 + M/N 常显 + 一键补全按钮全部交付）。
- 功能 3/4/6/10：不变（3 待 Phase-3；4/6 待 Phase-4；10 仍进行中 MVP 已交付）。

## 十三、下一阶段建议

按规划进 Phase-3（3-MVP：勾选导 MD + front-matter），复用本 Phase `qOrder/liveElByKey` 全集与 `buildExport` 过滤分支。进入前需用户验收本 Phase；建议用户实机验证：J/K 跳转、?帮助、总闸开关、补全三态/取消/恢复位、墨色主题、诊断版本一致。

## 十四、等待用户验收

**状态：等待用户验收 Phase 2。** 未获“验收通过/可以继续/开始下一阶段”前，不动 Phase-3 代码。
