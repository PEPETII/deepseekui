# DeepSeek UI
<img width="2372" height="1155" alt="1" src="https://github.com/user-attachments/assets/5a9dc2d4-509a-40ad-b89d-f97c77f1d976" />

Manifest V3 纯本地 Chrome 扩展，把 `https://chat.deepseek.com/*` 重排为中文文档工作台：阅读排版、右侧大纲、会话内查找、全量导出、打印、本地收藏。

## 功能特性

- **阅读排版**：可调纸宽（默认 880px）、字号、多种主题（含墨色主题）
- **右侧大纲**：基于会话问题列表自动生成，滚动定位、签名比对防抖动
- **会话内查找**：↑↓ 切换命中，只动注入节点高亮类名
- **全量导出**：MD / JSON / HTML，经 `chrome.downloads` 下载
- **打印**：独立 `@media print` 样式
- **本地收藏**：书签存储于 `chrome.storage.local`，支持标签与导入/导出（上限 100 条）
- **富文本输入（WYSIWYG）**：在原生 textarea 上方挂载本地 contenteditable 表面，内容序列化回原生输入框，Enter 按原生键盘事件转发给站点自身处理
- **格式工具栏**：Markdown 加粗/标题等格式切换（本地 `rich-model.js` 纯模型，无 DOM/网络依赖）

## 隐私与安全原则

- 不读取 token / cookie / 账号信息
- 不调用 DeepSeek 私有 API，不改 fetch
- 无后端、无远程请求；唯一网络出口是扩展自身的 `chrome.downloads`
- 导出 / 报告内容不包含对话正文之外的数据

## 安装

1. 下载本仓库到本地
2. 打开 Chrome，访问 `chrome://extensions/`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」，选择本仓库目录
5. 访问 `https://chat.deepseek.com/`，点击工具栏图标打开面板进行设置

## 项目结构

```
manifest.json        -> MV3 配置：权限（storage, downloads）、content_scripts、popup
popup.html           -> 面板结构 + 内联样式
popup.parts/*.js     -> popup 逻辑源文件（由 popup.html 按序 <script> 加载）
rich-model.js        -> 本地富文本模型（Markdown 解析/序列化/格式 toggle）
content.parts/*.js   -> 内容脚本源文件（由 manifest 按序加载，唯一可碰 DeepSeek DOM 的代码）
content.parts/*.css  -> 内容样式源文件（所有规则以 html[data-docdeep="on"] 开头）
background.js        -> 仅下载服务（DOCDEEP_DOWNLOAD -> chrome.downloads）
scripts/check-line-count.js -> 唯一工具脚本（行数门禁）
docs/                -> 已知问题、功能规划、工单计划、完成报告
```

无 npm、无构建步骤：`*.parts/` 文件即运行单元，保存后重载扩展即生效。

## 开发约定

- 版本号三处同步：`manifest.json` / `popup.parts/00-core.js:POPUP_VER` / `content.parts/00-runtime.js:VERSION`（`popup.html` 徽标为第 4 处展示位）
- 所有注入节点带 `docdeep-injected` 类（或 `id=docdeep-*`），关闭开关必须完整摘除并恢复原站
- CSS 规则一律以 `html[data-docdeep="on"]` 开头，禁止全局选择器；打印规则进 `@media print`
- 设置键统一进 `DEFAULTS` 并给安全默认值，老用户存量配置经 `{...DEFAULTS, ...stored}` 合并保证有效
- 人工维护的代码文件不超过 600 行，超限按职责拆分（改后运行 `node scripts/check-line-count.js`）
- 详细约束见 [AGENTS.md](AGENTS.md)

## 测试

```bash
node scripts/check-line-count.js
node --test tests/
```

回归必跑项：开关启停恢复原站、字号/主题/大纲、模板应用、复制全文、导出 MD/JSON、打印样式、查找 ↑↓、收藏增删开、流式时无大纲闪烁。

## License

仅供个人学习与本地使用。
