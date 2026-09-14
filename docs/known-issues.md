# 已知问题归档

## PAPER-WIDTH-001 纸张宽度设置视觉无效（已挂起）

- 状态：挂起（功能已冻结，默认 880px），v0.2.4 起 popup 中禁用该选项
- 影响：仅纸宽三档（760/880/1024）与自适应；字号/主题/大纲/复制/开关均正常
- 现象：切换纸宽后页面视觉无任何变化，强制刷新同样无效

### 证据（用户一键诊断报告，免手动采集）

1. v0.2.1 报告：设置 w=760，`computed:{f:18px,w:760px}` 期望=实际 —— 设置链路正常，变量已落盘
2. v0.2.2 报告：设置 w=1024，`widthProbe:{cardMax:1024px, cardW:751, parentW:752, innerMax:none}`
   → 卡片 max-width 已生效为 1024px，但父层仅 752px，卡片被父层卡住
3. v0.2.3 报告（解限规则已上线后）：用户反馈“还是无效”（未回传新报告即要求挂起）

### 已尝试的修复

- v0.2.1：确认变量注入链路（自证：心跳/ping/版本号），排除“旧包运行”因素
- v0.2.2：卡片加 `width:100%` + 选择器提权（`body` 层）；新增 widthProbe 实测卡片/容器宽度
- v0.2.3：`:where(div)` 零特异性解除 `.ds-virtual-list` 与 `main` 内各 div 的 max-width 上限；
  新增祖先链探针（上 8 层标签/类名/宽/上限）+ 视口/侧栏宽度 + “自适应”选项 + 视口 verdict

### 根因候选（按可能性排序）

1. 窗口本身不够宽：若 `视口 − 侧栏 ≈ 752px`，则 760/880/1024 三档全部超出可用宽度，看起来必然“没变化”
2. 祖先列固定宽度（`width:768px` 而非 max-width）：`max-width:none` 解不开，需结构选择器定向覆盖，
   但 v0.2.3 上线后用户未再回传祖先链数据，无法确认具体是哪一层
3. 虚拟列表 JS 内联写宽：若为行内样式，需 JS 级覆盖（侵入性高，暂不做）

### 冻结方案（v0.2.4）

- `content.js applySettings` 强制纸宽为 880 默认值（忽略存量，存量保留以便日后重开）
- popup 纸宽下拉禁用，标注“暂缓”
- 心跳/探针/verdict 全部保留， diagnoses 能力不受影响

### 重启条件（满足任一即重开）

- 用户在宽屏窗口（可用宽度 ≥1100px）下复测仍无效，并回传一份带 `chain.layers` 的诊断报告
- DeepSeek 改版后祖先列结构变化，探针显示瓶颈层消失

## OUTLINE-ORDER-001 大纲缺条目/顺序错乱（已撤销，v0.2.5 回退到 v0.2.4）

- 现象：扩展启用前已存在的 3 问对话，大纲最多显示 2 个“我的提问”；
  回到顶部后 3 个全显示，但顺序为 Q3-Q1-Q2（见用户截图）
- 根因：DeepSeek 虚拟列表会回收/复用 `.ds-message` 节点（滚出视口的节点被拿去显示别处内容），
  而旧代码“标记一次 + 按首次见到顺序编号（qCounter++）”，复用节点的旧标签永不修正。
  另：大纲渲染跳过条件只比条数+总长度，Q1→Q3 这类等长变化会被跳过
- 修复：
  1. `ensureUserTag` 不再编号，编号统一由 `renumber()` 按当前 DOM 从上到下分配（与大纲同源）
  2. 每次 classify 做对账：角色（`data-docrole`）翻转或用户文本指纹（`data-docfp`）变化 →
     `resetTurn()` 清标记后重标；AI 流式仅幂等维护思考按钮，不重置（避免按钮重复）
  3. 仅当节点集合/顺序变化（引用比对 `lastTurnOrder`）或有重标时才重编号，流式时零 churn
  4. 大纲跳过条件改全量标签字符串比对；`isUserTurn` 改 `textContent`（不触发布局，流式不卡）
- 预期外行为（非 bug）：虚拟列表未渲染（未滚到）的历史提问无法列入大纲，随滚动加载后自动补齐并重排
- 回退说明：上述修复已按要求整体撤销（v0.2.5→v0.2.4），以下 1–4 条仅作历史记录，当前代码仍为“标记一次 + 先见先编号”
- v0.3.0 跟进：content.js 已改为稳定注册表方案——提问 key 优先 `data-message-id`（否则
  `u:/a:` + 文本哈希），`qOrder/qInfo` 跨滚动累积全集并按 DOM 相对顺序合并（早问前插、
  新问后追加）；Q 编号按 `qOrder` 全局分配，滚动不再抖动；大纲渲染 Q 全集（未挂载置灰，
  点击自动定向滚动定位），签名改为含 key + 编号 + 文本 + 顺序的全量比对。
  剩余预期行为：从未滚到过的历史提问在首次挂载前仍无法显示，滚到后自动补齐并纠正编号。

## NATIVE-OUTLINE-001 读取 DeepSeek 自带右侧对话目录（v0.3.1，只读核对）

- 背景：DeepSeek 网页版右侧自带对话目录（用户报告当前构建为 `div._6ffc3c9`）。
  该类名是构建哈希，随时可能变化，不可写死依赖。
- 做法（`content.js probeNativeOutline/alignNativeWithRegistry`）：
  1. 多策略探测（按优先级取首个有效候选）：用户报告的哈希类名 → 侧栏导航语义
    （`aside nav/[role=navigation]`）→ 无障碍标签（目录/大纲/toc/outline）→
     疑似哈希类名单例容器（`_xxxxxx` 形且含 ≥2 个条目）；结果缓存 5s，原生节点绝不点击/改样式。
  2. 只读解析条目文本与顺序，与本地 `qOrder` 按文本包含关系贪心对齐（各用一次、保序）。
  3. 对上且原生更多时，大纲标题显示“本文大纲（已加载 M/N）”，滚动后自动补齐；
     编号仍以 `qOrder` 为准，原生结构未确认前不拿它重排，避免排错。
  4. 快照新增 `questions` 与 `nativeOutline{found,strategy,count,labelsHash,containerSig,sample}`，
     popup“检测状态”直接显示；“复制诊断报告”会带回原生容器指纹，用于下次钉死选择器。
- 需要用户回传（二选一）：点扩展 popup“检测状态”后“复制诊断报告”直接粘贴；
  或在右侧目录上右键→检查→复制该 `div` 的 `outerHTML` 发回。
  若原生目录列的是 AI 小节而非提问，对齐数会是 0，属正常，会保持现有行为。

## NATIVE-NAV-HIDE-001 隐藏官网自带右侧目录（v0.3.12，开关制，默认关）

- 背景：扩展已有自己的右侧大纲（`#docdeep-outline`），与官网自带目录（NATIVE-OUTLINE-001
  探测的容器，当前构建如 `div._6ffc3c9`）并存，用户希望可收起原目录。
- 与 NATIVE-OUTLINE-001 只读结论的关系：探测仍完全只读；隐藏是在其上新增的**可选**行为
  （新设置键 `docdeep_hide_native`，默认关，进 `DEFAULTS`），不改动原核对功能。
- 做法（`content.js nativeNavRoot/applyNativeNavHide` + `content.css`）：
  1. 复用 `probeNativeOutline` 多策略探测定位容器（带 5s 缓存）；
  2. 仅打 `data-docnavhide="1"` 标记 + CSS `display:none !important` 收起；
     不点击、不挪动、不删节点；沿“文本签名与目录完全相同”的纯包裹祖先向上扩大标记，
     连外层留白一并收起；签名不同或祖先包住扩展大纲/正文即停。
  3. `classify` 每轮重打标（虚拟列表/换会话重挂场景）；关开关或关扩展（`setOn(false)`）
     摘除全部标记并清探测缓存，原站完整恢复。
  4. 探测瞬时失败（会话切换瞬间容器为空/改版）时保留既有标记，避免目录闪烁；总闸关时不打标。
  5. 快照 `nativeOutline` 新增可选字段 `navHidden`，popup 诊断显示“已隐藏”；老快照无此字段不崩。
- 边界：隐藏后 `innerText` 对未渲染元素按 `textContent` 解析，条目计数/对账不受影响。
- v0.3.13 修复（Edge headless 真实 DOM 夹具复现定位）：
  1. 原目录条目是纯 div（`._81e7b5e > ._72b6158`），原解析只认 `a/button/[role=button]/li`
     得 0 条 → 探测判“未找到” → 隐藏跳过。已在 `parseNativeEntries` 加“叶子元素短文本”兜底
     （仅结构化选择器不足 2 条时启用）。
  2. 更关键：`._6ffc3c9` 在真实站点是**空壳 div（0 条目）**，把策略 1 候选占住后，
     兜底策略 4 的 `if (!candidates.length)` 永不触发 → 探测永远失败。
     已改为“策略 1-3 逐个验证，全部失败后才启用策略 4”，策略 4 另加几何约束
     （右侧 40% 视口内且宽 ≤420px）防误标主聊区/左栏。
  3. 真机夹具验证：`found=true strategy=hashed-container containerSig=DIV._189b4a0`，
     打标后 `display=none`，正文 h1 与侧栏按钮仍可见。
  4. v0.3.14 针对当前站点目录外层的 `--scroll-nav-page-padding` 结构增加高置信探测，
     并在隐藏开关切换时清理负探测缓存，避免目录异步挂载后仍复用“未发现”结果。

## Q-INFLATE-001 追问后大纲冒出 Q6…Q36“正在思考…”（v0.3.15 已修）

- 现象：位于 Q4 追问后，大纲出现 Q5(正常)+Q6…Q12+…(36/36)，赝 Q 摘要均为
  “正在思考正在思考分析…”（见用户截图）。
- 根因：`isUserTurn` 只排除了 `AI_SEL`。新回答思考流阶段的 assistant 气泡只有
  `THINK_SEL`、尚无 `AI_SEL`，被误判为 user；无 `data-message-id` 时 key 为
  `u:+文本哈希`，流式文本每变长一次就产生一个新哈希 key，只增不减，
  一次追问即膨胀数十条。另 `TURN_SEL` 父子嵌套（`.ds-message` 含
  `[data-message-id]`）会把同一消息计两次。
- 修复（`content.js`，版本号同步 bump 至 0.3.15）：
  1. `isAssistantStructure`：含/即为 `AI_SEL` 或 `THINK_SEL` 一律判 assistant；
     `isUserTurn` 先过此门。
  2. `updateQuestionRegistry` 纵深复核：同批 role 仍是旧值时以实时结构再拦一次，
     赝文本（`isBogusQuestionText`）不入库。
  3. `classify` 对 `TURN_SEL` 结果去嵌套，只留最外层。
  4. `pruneBogusQuestions`：每轮摘除已污染的 `u:` 赝 key（双写“正在思考…”严格判定，
     单次“正在思考是什么意思?”类真实提问不受影响），同步清 `qInfo/liveElByKey/selectedQKeys`，
     无需刷新即自愈。
- 回归：Node 自测 12 项（用户问通过/思考流拦截/回答拦截/自节点拦截/赝文本双写判真、
  Q5 真实文本与单次正在思考不误杀/嵌套去重/清理保持真实+选中态）全过；
  `node --check` 两 JS 通过；三处版本一致。

## DIAG-REMOVE-001 诊断自证链路整功能删除（v0.3.20，非缺陷修复，记录性条目）

- 背景：应用户要求从代码库完整移除“诊断”界面及相关实现（历史条目中
  `widthProbe`/快照字段/`nativeOutline.count` 等记载即为该链路的历史现场，结论保留不改写）。
- 删除范围：
  1. popup：诊断 Tab + 运行状态 pane（`#check` 检测状态、`#diag` 结果区、
     `#report` 复制诊断报告）+ `.diag` 样式块 + `--ok/--bad` 令牌 +
     `@keyframes spin` + `.btn-mini`（后两者唯一消费方均在诊断内）。
  2. content.js：`snapshot()` 快照（含 widthProbe/chain/nativeOutline 采集）、
     `heartbeat()` 4s 心跳写 `docdeep_heartbeat`、`DOCDEEP_PING` 直回、
     `window.__DOCDEEP__` 暴露、诊断适配层 `nativeOutlineSnapshot()`。
  3. 旧键清理：popup `load()` 的 `remove` 列表追加 `docdeep_heartbeat`。
- 保留说明：`probeNativeOutline()` 为功能代码（目录隐藏打标/补全计数/原生对账消费），
  本体保留，仅删其上的诊断适配层；返回对象中 `labelsHash/containerSig/sample/refs`
  自此无消费方，按最小侵入保留未动。
- 回归：`node --check` 三 JS 通过；三处版本 `0.3.20` 一致；popup id 交叉校验无悬空；
  tabs/panes（read/act/mark）对齐；Edge headless 渲染 popup 截图正常。
  详见 `docs/工单计划/删除诊断-工单.md` 与 `docs/完成报告/删除诊断-完成报告.md`。

## RICH-FRAME-001 富文本表面聚焦浮现赤陶竖线 / 溢出叠加系统滚动条（v0.3.25 修复）

- 现象：在原生输入栏里选中文字、弹出选区格式工具栏时（那一刻编辑器正好取得焦点），
  输入栏左内边缘会浮现一条 2px 赤陶竖线；正文超出可视高度时，右侧还会多出一条
  15px 系统滚动条。两者都让输入栏外观偏离未聚焦时的常态，看起来像多余装饰。
- 定位：
  1. `#docdeep-rich-editor:focus { border-left-color: var(--dd-brand) }` 是从原生 textarea
     的「聚焦时左侧浮现强调色竖线」设计复制来的。但编辑器是铺满 textarea 的覆盖层，
     这条竖线必然与格式工具栏同时出现，被读成多余的竖栏/滑动条。
     （像素扫描佐证：图一无橙色列，图二仅 `x=40..42` 三列呈赤陶色；两图滚动条
     同在 `x≈1189`、同宽同高，故图二新增元素只有这条竖线。）
  2. 滚动条是 `overflow: auto` 在内容溢出时的默认占位（`offsetWidth - clientWidth = 15px`），
     占位会把正文宽度压窄 15px，与常态不一致。
- 修复（仅 `content.css`，`#docdeep-rich-editor` 两处）：
  1. 删除 `border-left: 2px solid transparent` 与整个 `:focus` 块；左内边距由 `8px 12px`
     改为 `8px 12px 8px 14px`，把原先占位的 2px 边框宽度并入内边距——文本起始 x
     与内容区宽度与改动前逐像素一致（夹具实测四状态恒定 149px）。
  2. 新增 `scrollbar-width: none` 与 `::-webkit-scrollbar { width: 0; height: 0 }`：
     编辑器滚动条既不绘制也不占位；`overflow: auto` 保留，滚轮/键盘滚动行为不变。
- 范围边界：只改覆盖层。原生 `textarea:focus` 的同类竖线规则未动（富文本模式下它被
  编辑器完全遮挡，仅当用户关掉 `docdeep_format` 时才可见），故原生输入框既有外观不变。
- 回归：`node --check` 五个 JS 通过；44/44 单测通过；夹具探针四状态
  （未聚焦 / 聚焦空 / 选中 / 溢出）均为 `border-left = 0px none`、`vScrollbar = 0px`、
  文本起始 x 恒定；四状态 Edge headless 截图无新异常。

## RICH-OFFSET-001 富文本表面退化为空容器 / 裸文本节点时偏移换算抛 childNodes 异常（v0.3.26 修复）

- 现象：会话页（`/a/chat/s/<id>`）控制台报
  `Uncaught TypeError: Cannot read properties of undefined (reading 'childNodes')`，
  栈顶 `content.js`（修复前为 `:715`，即 `richPointFromOffset` 尾部的 `last.childNodes.length`）。
- 根因：`richBlockElements(root)` 只看 `root.children`（元素子节点）。contenteditable 被
  「全选删除」后可能留下零子节点容器；更常见的是容器没有块子节点时，浏览器把随后的输入
  **直接写成裸文本节点**。两种情况下 `blocks` 都是空数组 → 循环一次都不执行 →
  `last = undefined` → 抛错。
- 连带缺陷（同一根因、未被报错暴露）：`readRichModel` 同样以 `richBlockElements` 为唯一来源，
  遇到游离内容时把已输入文本读成空串 → 内容被静默丢弃、textarea 被写空。
- 修复（仅 `content.js`）：
  1. 新增 `ensureRichBlocks(editor)`：无元素子节点时，把游离内容收进一个
     `docBlockKind="text"` 的块；真空容器补一个 `<br>` 块。幂等，正常编辑器零动作。
  2. `richPointFromOffset` 入口加空保护：`root` 为空返回 `{node: null, offset: 0}`；
     `blocks` 为空返回 `{node: root, offset: 0}`（调用方 `richRangeFromOffsets` 已有 try/catch）。
  3. `readRichModel` 与 `handleRichInput` 在读数/读选区前调用 `ensureRichBlocks`，
     避免读数丢失并让首次按键后的偏移量就落在块内；`handleRichInput` 保留 `composing`
     提前返回，不在 IME 组字期间动 DOM。
- 范围边界：不改 `richPointOffset` / `richBlockTextLength` / `richBlockBaseOffset` 的既有语义，
  不动消息协议、存储键、发送链路与原生 textarea 归属。
- 回归：`node --check` 通过；既有单测 44/44 通过；jsdom 抽取真实函数跑 13/13 —— 含
  「旧实现复现上述报错」「正常多块编辑器 0..10 偏移与修复前逐点一致」「ensureRichBlocks 幂等」。
  真实 DeepSeek 页面的实机确认仍待用户补测。
