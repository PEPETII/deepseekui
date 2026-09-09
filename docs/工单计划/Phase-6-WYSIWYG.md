# Phase 6 WYSIWYG 修订工单（本地富文本表面 + Markdown 底层同步）

## 一、修订目标

当前 Phase-6 的原生 `textarea` 工具栏只改写 Markdown 字符串，因此选中文本后会看到 `**文本**`。本修订在不向 DeepSeek 发送 HTML 的前提下，为同一个原生输入区域增加本地 `contenteditable` 富文本表面，使加粗直接显示为真实粗体。

## 二、已确认的现状与根因

- `content.js:nativeComposerTextarea()` 找到 DeepSeek 原生 `textarea`。
- `makeFormattingButton()` 的 B 按钮调用 `applyMarkdownToTextarea()`。
- `applyMarkdownToTextarea()` 调用 `formatMarkdownValue()`；其中 `kind === 'bold'` 的 marker 是 `**`，再经 `setRangeText()` 写回 textarea，并派发 `input`。
- `textarea` 只能保存纯字符串，不能在同一个文本框内给局部字符应用 `<strong>` 的渲染样式；直接把 `**` 换成 `<strong>` 只会显示 HTML 字符串，不会变成富文本。

## 三、技术决策

- 新增无 DOM、无网络、无第三方依赖的 `rich-model.js`，以 block + inline runs 保存文本和 marks。
- `content.js` 在原生 textarea 上方挂载可摘除的固定 `contenteditable` 表面；textarea 不移动、不重建，仍留在原 form 中保存 Markdown。
- 富文本表面输入经过模型解析/序列化同步到 textarea；DeepSeek 仍只接收其原生 textarea 的 Markdown 字符串。
- 选区格式化按文本偏移切分 run，禁止把 `Range.surroundContents()` 作为唯一实现。格式化后恢复同一偏移范围、方向和焦点。
- 不引入 Tiptap、ProseMirror、Lexical 或 CDN。若未来改用成熟编辑器，必须本地打包并单独评估包体、MV3 CSP、许可证、Markdown 扩展和原生同步风险。

## 四、明确的架构例外

原项目原则是“不移动、不重建、不代理原生 textarea/form/发送按钮”。真正 WYSIWYG 无法仅靠 textarea 完成，因此本修订只保留节点树和 form 归属，但代理可视输入、焦点和输入同步：textarea 被设为不可见/不可点击，contenteditable 承载编辑；普通 Enter 在确认原生发送按钮可用后点击该按钮，Shift+Enter 仍由富文本表面默认换行。关闭扩展会移除表面、解绑监听并恢复 textarea 的属性。

## 五、白名单文件

- `rich-model.js`：Markdown 解析/序列化、marks toggle、块级格式和偏移模型。
- `content.js`：富文本 DOM 表面、选区映射、工具栏接线、textarea 同步、生命周期和原生发送按钮入口。
- `content.css`：表面、真实 strong/em/s/code 显示和 textarea 遮罩；所有规则必须带 `html[data-docdeep="on"]` 前缀。
- `manifest.json`：仅加入本地 `rich-model.js` content script 并同步版本，不增加权限或 host。
- `popup.js`、`popup.html`：同步可见版本/名称语义，不增加新的外部权限。
- `AGENTS.md`、路线图、工单和完成报告：记录架构例外、验收边界和风险。
- `tests/rich-model.test.js`：模型级 Node 测试。

## 六、实施任务与验收标准

1. 实现 Markdown ↔ marks 模型：至少支持 bold、italic、strike、inline code、safe link 和 text/h1/h2/h3/ordered/unordered block。
2. 实现非空选区 toggle：选区未完全加粗则全选区加粗，已完全加粗则取消；空选区只改变后续输入的 typing mark。
3. 实现跨 run、跨 block 的偏移切分，不破坏其他 marks；代码 run 不被错误套入粗体。
4. 通过 toolbar `mousedown` 保存 Selection，操作后恢复 Selection、方向和焦点；快捷键也走同一模型路径。
5. 富文本变化实时序列化到原生 textarea 并派发冒泡 input；发送前不向 DeepSeek 传 HTML。
6. `classify()` 反复运行、textarea 替换、路由切换和关闭扩展时不重复注入，且能够解绑/恢复。
7. 运行模型测试、语法检查、manifest/version/CSS 前缀及无 CDN/fetch/新增权限静态检查。
8. 浏览器实机必须另行验证真实 DeepSeek 的视觉、发送、IME、Undo/Redo、粘贴、附件、草稿和 SPA 重挂。

## 七、边界与风险

- 空选区需要保持 caret 并让后续输入继承 typing mark；代码块/行内代码不应被 inline Bold 改写。
- 跨节点 Selection 不依赖 DOM 包裹操作，而依赖模型偏移；复杂嵌套 Markdown 的解析范围需要保守记录。
- IME composition 期间不得触发格式快捷键或重渲染；compositionend 后再同步。
- 浏览器原生 contenteditable Undo/Redo、富文本粘贴清洗和 DeepSeek 受控 textarea 回写需要实机验证。
- DeepSeek SPA 可能重挂 textarea；需要通过 `classify()` 发现新节点并重新绑定，旧节点必须恢复。
- 当前模型不是完整 CommonMark 编辑器；不承诺保留未实现的扩展语法、表格、引用、代码块等复杂 Markdown 结构。

## 八、完成门禁

静态与模型测试通过只能说明代码路径和纯模型已验证，不能替代 DeepSeek 浏览器验收。若真实站点的发送、IME、撤销/重做或重挂行为失败，应暂停发布并回退到原生 textarea Markdown 工具栏或 Markdown + 实时预览方案。
