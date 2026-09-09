# Phase 6 WYSIWYG 修订完成报告

## 一、结果

已完成本地 WYSIWYG 富文本表面和 Markdown 底层同步的代码实现。原生 textarea、form、发送按钮节点未移动或重建，但可视输入和焦点由新增 contenteditable 表面承载；这是为满足“编辑器内直接显示真实粗体”而记录的明确架构例外。

## 二、根因与当前架构判断

修改前 `content.js:makeFormattingButton()` 的 B 按钮进入 `applyMarkdownToTextarea()`，再调用 `formatMarkdownValue()`。该函数把 bold 映射成 `**`，最后由 `textarea.setRangeText()` 写回字符串并派发 input。原生 textarea 没有局部富文本渲染能力，因此不能通过把字符串替换为 `<strong>` 来实现所见即所得。

## 三、实际修改

- `rich-model.js`：新增 block/inline marks 模型、Markdown 解析/序列化、跨 run 选区切分、bold/italic/strike toggle 和块级格式切换。
- `content.js`：新增富文本表面挂载与清理、DOM ↔ 模型映射、文本偏移选区映射、toolbar mousedown 保存选区、真实 strong/em/s/code 渲染、textarea 同步和原生发送按钮调用；保留旧 Markdown textarea 路径作为兼容回退函数。
- `content.css`：新增 fixed contenteditable 表面和真实行内格式样式；textarea 只在富文本绑定期间透明且不可点击，关闭后恢复。
- `manifest.json`：加入本地 `rich-model.js`，未增加权限或 host。
- `popup.js`、`popup.html`：版本/界面文案同步为 `0.3.21` 和富文本格式工具栏。
- `AGENTS.md`、`docs/功能扩展规划.md`、本修订工单：记录 textarea 局限和架构例外。
- `tests/rich-model.test.js`：新增模型级回归测试。

## 四、关键行为

- 非空选区：未完全 Bold 时加粗整个选区，已完全 Bold 时取消；部分加粗会统一为加粗。
- 空选区：不修改已有文本，只切换后续输入的 Bold typing mark，并保持 caret。
- 跨多个 text/node 或 block：先映射到统一文本偏移，再切分 runs，不使用 `Range.surroundContents()`。
- 其他 marks：Bold 可与 Italic/删除线/链接叠加；inline code 作为不可被 Bold 改写的保护范围。
- 工具栏点击：`mousedown` 阶段保存 Selection，格式化后恢复方向、范围和焦点；快捷键走相同 toggle。
- 同步/发送：contenteditable 只显示 DOM marks；每次变更序列化成 Markdown 写回原生 textarea，DeepSeek 不接收 `<strong>` HTML。Enter 仅在找到可用原生发送按钮时代理为按钮点击，否则保留编辑器默认行为；Shift+Enter 不代理。
- 生命周期：富文本表面带 `docdeep-injected`/固定 ID；`setOn(false)`、功能关闭和 textarea 重挂会清理绑定并恢复原生 textarea 属性。

## 五、依赖与 MV3 评估

没有引入 Tiptap、ProseMirror、Lexical、npm 运行时或 CDN。`rich-model.js` 是扩展目录内的本地 content script，符合当前纯本地 MV3 约束，不需要新增权限、host、远程请求或 CSP 放宽。代价是模型只覆盖已实现的 Markdown 子集，复杂 Markdown 结构和成熟编辑器级历史记录仍需后续评估。

## 六、验证结果

- `node --test tests/rich-model.test.js`：8/8 通过。
- `node --check rich-model.js`、`content.js`、`popup.js`、`background.js`：退出码均为 0。
- manifest JSON、四处版本同步、CSS 前缀、无 `Range.surroundContents()`、无新增权限/CDN/fetch：静态断言通过。
- 当前 CUA 环境无可用浏览器标签页，无法取得真实 DeepSeek DOM 或截图；浏览器视觉、真实发送、IME、Undo/Redo、粘贴、附件、草稿和 SPA 重挂均未完成实机验收。

## 七、风险与替代方案

最大风险是 DeepSeek 当前输入组件对 textarea 的受控回写、原生发送按钮定位、contenteditable 原生 Undo/Redo 或粘贴行为与模型重渲染发生冲突。若实机验证不通过，安全回退方案是保留当前 textarea Markdown 工具栏，或新增只读 Markdown + 实时预览面板：预览区显示 `<strong>` 效果，但发送仍使用 textarea；后者不满足“直接在编辑区内 WYSIWYG”，却不代理原生输入，回归风险最低。

## 八、工作区状态

本报告与实现文件一并纳入本轮 Git 变更；最终是否已提交/推送以交付时的 Git 命令结果为准。不得将本报告的静态通过表述为 DeepSeek 实机已通过。
