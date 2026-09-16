# DeepSeek 主页面大背景图完成报告

## 一、阶段目标回顾

按 `docs/工单计划/DeepSeek主页面大背景图-工单计划.md`，仅为 DeepSeek 正常聊天工作区接入一张固定整页背景图；验证显示、层级、可读性、原生交互、SPA 和关闭恢复链路，不扩展为完整壁纸系统。版本同步为 `0.3.42`。

## 二、已完成任务

- Task 1：复核现有 `classify()`、`setOn(false)`、工作区结构探测和注入层级。
- Task 2：加入指定 PNG 背景资源、独立背景节点与 manifest 资源暴露。
- Task 3：使用负层级隔离将背景置于页面内容后方，保留既有高层 UI。
- Task 4：保留消息/输入区域纸面，背景固定透明度 `.40`，打印隐藏背景。
- Task 5：SPA 路由变化复用 `classify()` 同步，重复节点在同步时清理为最多一个。
- Task 6：关闭扩展显式移除背景，并继续复用全局 `.docdeep-injected` 摘除链。
- 缺陷修正：截图暴露新建会话根路径未命中；`v0.3.42` 将 `/` 纳入候选路径，同时保留 textarea 与工作区壳层门控，新增根路径挂载/缺少壳层不挂载回归。

## 三、实际修改内容

- `content.parts/12-page-background.js`：新增工作区路径判定、composer/壳层 fail-closed 门控、单节点创建/去重、`chrome.runtime.getURL()` 资源地址和移除函数。
- `content.parts/10-page-background.css`：新增 fixed/inset/cover/center/no-repeat/pointer-events/opacity 规则；用 `isolation` 和 `z-index:-1` 放到内容下方；仅在背景节点存在时令 body 透明；打印时隐藏。
- `content.parts/12-navigation.js`：在既有 `classify()` 生命周期入口同步背景，覆盖刷新后的首次分类和 SPA 路由更新。
- `content.parts/00-runtime.js`：关闭时显式调用 `removePageBackground()`，开启时同步背景；版本改为 `0.3.42`。
- `manifest.json`：加载新 JS/CSS，增加指定 PNG 的 `web_accessible_resources`；权限和 host 保持不变；版本改为 `0.3.42`。
- `popup.parts/00-core.js`、`popup.html`、`AGENTS.md`：同步版本 `0.3.42`。
- `tests/page-background.test.js`：新增 8 项路由、生命周期、CSS、DOM 夹具和 manifest 静态/纯函数回归。
- `docs/功能扩展规划.md`：登记本专题状态和完成报告链接。

## 四、本轮新增代码与使用素材

- `assets/backgrounds/main-background.png`：用户指定且本轮开始前已存在的 1920×1080 PNG，约 2.49 MB；本轮仅核验并引用，未改写。
- `content.parts/12-page-background.js`
- `content.parts/10-page-background.css`
- `tests/page-background.test.js`
- `docs/完成报告/DeepSeek主页面大背景图-完成报告.md`

## 五、修改文件

- `manifest.json`
- `content.parts/00-runtime.js`
- `content.parts/12-navigation.js`
- `popup.parts/00-core.js`
- `popup.html`
- `AGENTS.md`
- `docs/功能扩展规划.md`

本轮未修改 `background.js`、权限集合、存储键、消息协议、原生 textarea/form/发送按钮和主题令牌。

工作区在本轮开始前/执行期间已有其它未提交差异：`content.parts/00-foundation.css`、`content.parts/01-reading.css`、`content.parts/02-composer-rich.css`、`content.parts/02-shell.js`、`content.parts/04-shell.css` 含主题表面相关改动；`content.parts/00-runtime.js`、`content.parts/12-navigation.js` 也含对应的 `data-docsurface` 接线。上述差异不属于本背景工单，本轮未覆盖、回滚或据此扩大范围。

## 六、关键实现说明

1. 工作区门控：路径允许根路径新建会话、`/chat`、`/a/chat` 及已有会话形态；根路径也必须同时满足页面存在 textarea 和 DeepSeek 工作区壳层（`the-header`、侧栏宽度变量、虚拟列表或消息节点），分享路径显式排除。任一条件不满足即不显示。
2. 单节点与 SPA：`syncPageBackground()` 只查询带 `docdeep-injected` 的目标节点，先清除重复节点；`classify()` 每次既有 120ms 防抖调度时同步一次，不使用背景专用定时器或 MutationObserver。
3. 层级：背景节点 fixed 且 `z-index:-1`，根节点在背景存在时 `isolation:isolate`，body 仅在背景存在时透明；为兼容工作区已有的 `data-docsurface="page"` 外层标记，仅增加约 `.80` 的主题纸面透明度，消息卡、输入框、目录、工具栏和弹窗规则保持原样。
4. 资源：背景地址由 `chrome.runtime.getURL()` 生成，manifest 只暴露 `assets/backgrounds/main-background.png` 给 `https://chat.deepseek.com/*`；没有新增无关 host 权限或远程请求。
5. 可摘除：背景节点带 `docdeep-injected` 和 `data-doc-background`；`setOn(false)` 显式调用移除函数，之后既有统一注入清理继续兜底。

## 七、测试结果

- `node --check content.parts/12-page-background.js content.parts/00-runtime.js content.parts/12-navigation.js popup.parts/00-core.js`：通过，退出码 0。
- `node --test tests/page-background.test.js`：8/8 通过，退出码 0。
- `node scripts/check-line-count.js`：全部源文件 `ok`，无超过 600 行文件，退出码 0。
- manifest JSON/四处版本/权限检查：通过，输出版本 `0.3.42`，权限仍为 `storage, downloads`，host 仍为 `https://chat.deepseek.com/*`。
- 资源核验：PNG 读取头信息确认格式 PNG、尺寸 1920×1080、字节数 2,487,944。
- 新增背景 CSS 专项断言：固定、覆盖、居中、不平铺、穿透、透明度和打印隐藏均通过。

## 八、回归测试结果

代码级通过：

- 路由：根路径新会话候选、`/a/chat` 和已有会话路径命中；登录、注册、404、分享和不完整路径不命中；根路径缺少工作区壳层时不挂载。
- 生命周期：开启同步、关闭移除、SPA 复用 `classify()`、重复节点清理和资源 URL 路径均有静态断言。
- 层级与交互：CSS 明确 `pointer-events:none`；背景位于负层级，既有 `2147483000+` 的扩展浮层继续高于背景；没有新增事件监听或原生节点操作。主阅读外层仅在背景存在时按三主题有限透出，正文卡片及功能浮层不透明。
- 主题与阅读：本轮背景实现未修改 `--dd-surface`、`--dd-surface-2`、消息卡、代码块、输入框和三主题令牌；统一背景透明度为 `.40`。工作区其它未提交主题表面差异不纳入本轮结论。
- 打印：背景节点 `display:none !important`，body 在背景节点存在时恢复白底。
- 全量测试：本轮新增测试纳入后，现有 60 个测试中 59 个通过；`tests/think-collapse.test.js` 仍因环境缺少 `jsdom` 失败，见下一节。

## 九、发现的问题

- 已确认：本环境没有可接管的浏览器标签；`cua.getState()` 返回 `browsers: []`，并报告 `nodeRepl.fetch request failed`，因此本轮没有把静态结果冒充 DeepSeek 实机视觉结果。
- 已确认：全量测试的唯一失败是 `Error: Cannot find module 'jsdom'`，来源为既有 `tests/think-collapse.test.js`；基线修改前同样是 51/52 通过、同一错误，非本轮引入。
- 已确认：一次通用 CSS 前缀扫描把既有 `@keyframes` 的 `from/to` 误当成未前缀选择器；该脚本不作为本轮失败结论，新增 CSS 已用专项断言和人工结构复核验证。

## 十、遗留问题

1. 需要用户在 Chrome/Edge 重载扩展并刷新 DeepSeek，确认真实页面背景显示、正文阅读性和层级。
2. 需要按工单验证新会话、已有/长会话、流式输出、20 个会话切换、回到已有会话、输入/选择文字/按钮点击、三主题和打印预览。
3. 若真实站点正文外层存在独立不透明 stacking context，需根据实机截图再评估背景可见范围；本轮未改动正文纸面以控制风险。

## 十一、与原工单的差异

- 实现范围与工单一致，使用用户指定 PNG 而非另行转换为 WebP；没有实现第二张背景、主题选择 UI、壁纸库、上传、动态/视频背景或侧栏人物背景。
- 为满足 fail-closed，增加了“路由 + textarea + 工作区壳层”三重门控；这是对工单适用页面要求的具体化，不改变其它功能。
- 未能执行真实浏览器视觉与 20 会话人工回归，已在报告和规划中标明等待用户验收。

## 十二、功能状态变化

- 主页面背景：未实现 → `v0.3.42` 已补齐根路径新建会话门控并完成代码级静态验证，等待实机验收。
- 资源：新增单一本地 PNG 的 web-accessible 暴露；无新增 host 权限。
- 后续壁纸系统：仍未立项，用户验收前不进入下一阶段。

## 十三、下一阶段建议

无自动下一阶段。请先重载扩展并按工单完成实机验收；若背景过强，只在本专题内调整 `.40` 透明度或层级证据，不扩展主题系统。

## 十四、等待用户验收

**状态：`0.3.42` 代码、静态专项测试和文档已完成，等待用户进行 Chrome/Edge 实机验收。** 未经用户明确“验收通过/可以继续”，不进入第二张背景、侧栏人物图、自定义上传或壁纸设置等后续范围。
