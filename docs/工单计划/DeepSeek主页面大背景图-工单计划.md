# 工单：仅实现 DeepSeek 主页面大背景图

## 一、任务目标

本阶段只实现一个功能：

> 在 DeepSeek 网页版聊天主界面加入一张覆盖整个主页面的大背景图。

参考 `naniwet/dsh-themes` 中的：

```text
backgroundLight / backgroundDark
```

但本阶段**不实现完整壁纸系统**，只先完成“最大背景图”这一层。

目标是先验证：

```text
背景图能否稳定显示
+
是否影响正文阅读
+
是否影响 DeepSeek 原有交互
```

---

## 二、本阶段只做什么

仅实现：

```text
DeepSeek 聊天工作区整页背景图
```

要求：

- 背景覆盖整个浏览器可视区域；
- 背景固定，不随聊天内容滚动；
- 使用 `background-size: cover`；
- 使用 `background-position: center center`；
- 不重复平铺；
- 不拦截鼠标；
- 不影响输入、滚动、选择文字、按钮点击；
- 页面刷新后仍正常生效；
- SPA 切换不同会话后仍正常存在；
- 扩展关闭后恢复 DeepSeek 原页面。

---

## 三、本阶段明确不做

暂时全部不做：

- 侧栏人物背景；
- sidebar overlay；
- Logo 替换；
- favicon 替换；
- 新建会话按钮图标；
- 装饰边框；
- 主题包；
- 壁纸库；
- 在线图片；
- 多背景切换；
- 图片上传；
- 图片管理；
- 动态背景；
- 视频背景；
- GIF；
- 定时轮播；
- 多套动漫主题；
- 背景配置面板；
- 独立的浅色 / 深色背景选择 UI。

也就是说，本阶段不要把任务扩大成完整主题系统。

---

## 四、实现原则

不要直接修改 DeepSeek 自身源码。

继续通过当前浏览器扩展注入实现。

当前已有：

```css
html[data-docdeep="on"] body {
  background: #F8F7F4 !important;
}
```

位于：

```text
content.parts/00-foundation.css
```

不建议简单将其替换成：

```css
body {
  background-image: url(...);
}
```

更推荐建立独立背景层，例如：

```html
<div id="docdeep-page-background"></div>
```

样式要求：

```css
position: fixed;
inset: 0;
pointer-events: none;
background-size: cover;
background-position: center center;
background-repeat: no-repeat;
```

背景层必须位于：

```text
DeepSeek 正文和功能 UI 下方
```

不能覆盖输入框、消息、目录、工具栏和弹窗。

---

## 五、背景图资源

建议新增：

```text
assets/backgrounds/main-background.*
```

具体格式允许：

```text
png
jpg
webp
```

优先建议：

```text
webp
```

以减少扩展体积。

### 资源要求

建议分辨率：

```text
>= 1920 × 1080
```

图片主体尽量避开：

```text
页面中央正文区域
```

避免影响聊天阅读。

---

## 六、参考项目素材限制

参考项目中的 SPY×FAMILY 图片可以作为实现效果参考，但不要默认复制进正式仓库。

如果开发时需要使用参考图验证效果：

```text
仅用于本地测试
```

正式提交前应替换为：

```text
自有图片
或
明确允许再分发的图片
```

除非已经确认对应素材授权允许项目分发。

---

## 七、建议实现方式

推荐新增独立文件：

```text
content.parts/XX-page-background.js
content.parts/XX-page-background.css
```

具体编号根据当前 `manifest.json` 加载顺序确定。

### JS 负责

- 创建背景节点；
- 防止重复创建；
- 扩展开启时挂载；
- 扩展关闭时移除；
- SPA 会话切换后保持；
- 必要时设置图片 URL。

### CSS 负责

- fixed 定位；
- cover；
- center；
- opacity；
- pointer-events；
- z-index；
- 响应式尺寸。

不要把大量新代码塞入：

```text
00-runtime.js
```

---

## 八、背景透明度

本阶段允许固定一个默认透明度。

建议：

```text
0.30 ~ 0.50
```

可先使用：

```text
0.40
```

本阶段**不需要增加 Popup 调节滑块**。

如果背景过强，应直接在 CSS 中调整。

---

## 九、阅读区域处理

背景图片不能导致正文难以阅读。

本阶段采用最小改动原则：

- 保留现有正文纸面；
- 保留现有输入框背景；
- 保留代码块背景；
- 保留右侧目录背景；
- 保留工具栏背景。

不要为了展示背景图而把所有区域改成透明。

如果当前正文区域完全遮挡背景，则只允许针对“主阅读区域外层”进行有限透明度调整。

禁止大范围改：

```text
--dd-surface
--dd-surface-2
```

避免引起整个 UI 连锁变化。

---

## 十、主题处理

本阶段不实现：

```text
浅色一张
深色一张
```

只使用：

```text
一张统一背景图
```

要求至少在：

```text
mi
bai
mo
```

三种现有主题下都不出现严重可读性问题。

如果墨色主题下效果不理想：

```text
允许通过 overlay / opacity 调整
```

但不要新增第二张背景图。

---

## 十一、适用页面

优先只在：

```text
DeepSeek 正常聊天工作区
```

生效。

不要默认扩展到：

```text
登录页
注册页
分享页
404 页
```

Codex 需要根据现有页面识别逻辑判断聊天工作区。

如果目前项目尚无可靠识别方式，则必须采用 fail-closed：

```text
无法确认是聊天工作区
→ 不显示背景
```

---

## 十二、Manifest

检查是否需要：

```text
web_accessible_resources
```

如果背景图通过：

```js
chrome.runtime.getURL(...)
```

提供给页面资源使用，则按 Manifest V3 实际要求处理。

只允许：

```text
https://chat.deepseek.com/*
```

禁止增加无关 host 权限。

---

## 十三、任务拆解

### Task 1：确认现有页面结构

检查：

```text
body
主聊天壳层
扩展开关
SPA 路由
现有 z-index
```

需覆盖已有会话与新建会话；若新建会话停留在站点根路径 `/`，只能在同时确认 textarea 和 DeepSeek 工作区壳层后视为可挂载工作区。

确认背景节点最安全的挂载位置。

---

### Task 2：加入单一大背景图

实现：

```text
#docdeep-page-background
```

要求：

- 页面只存在一个；
- `position: fixed`；
- `inset: 0`；
- `pointer-events: none`；
- `background-size: cover`；
- `background-position: center`;
- `background-repeat: no-repeat`。

---

### Task 3：处理层级

确保：

```text
背景
<
DeepSeek 主内容
<
输入框 / 目录 / 工具栏 / 弹窗
```

不能出现：

- 背景盖住文字；
- 背景挡点击；
- 弹窗出现在背景下面。

---

### Task 4：阅读性检查

验证：

- 用户消息；
- Assistant 消息；
- 思考过程；
- Markdown；
- 表格；
- 代码块；
- 输入框。

必要时只做局部透明度处理。

---

### Task 5：SPA 回归

连续切换至少：

```text
20 个会话 / 新建会话 / 返回已有会话
```

验证：

```text
背景节点始终只有 1 个
```

---

### Task 6：关闭扩展

关闭 `deepseekui` 后：

```text
背景节点被完全删除
```

原 DeepSeek 页面恢复。

---

## 十四、测试要求

至少验证：

### 页面

```text
新会话
已有会话
长会话
流式输出
```

### 内容

```text
普通文本
代码块
表格
引用
思考过程
```

### UI

```text
输入框
目录
查找
格式工具栏
侧栏
弹窗
```

### 主题

```text
mi
bai
mo
```

---

## 十五、性能要求

禁止：

- 高频定时器维护背景；
- 每次 token 输出时重新创建背景；
- MutationObserver 扫描整个 DOM；
- SPA 切换后不断新增背景节点；
- 对所有消息节点添加 blur。

背景本身应接近：

```text
静态 fixed 图层
```

---

## 十六、代码约束

继续遵守：

```text
单文件 <= 600 行
```

新增功能尽量独立。

不得破坏：

- Enter 发送；
- 富文本输入；
- 选区格式工具栏；
- 添加到输入框；
- 查找；
- 目录；
- 导出；
- 收藏；
- 打印；
- 主题切换。

---

## 十七、Definition of Done

完成条件：

- [ ] DeepSeek 聊天页显示一张完整大背景；
- [ ] 背景固定不滚动；
- [ ] 背景 cover；
- [ ] 背景居中；
- [ ] 不重复平铺；
- [ ] 不挡鼠标；
- [ ] 不挡输入框；
- [ ] 不影响文字选择；
- [ ] SPA 切换不重复创建；
- [ ] 页面中背景节点始终最多 1 个；
- [ ] 三种现有主题均可正常使用；
- [ ] 正文保持可读；
- [ ] 代码块保持可读；
- [ ] 扩展关闭后背景消失；
- [ ] 未增加无关权限；
- [ ] 未扩大到其它主题素材功能；
- [ ] 所有文件仍 <=600 行；
- [ ] 原有测试通过。

---

## 十八、本阶段结束条件

本阶段只验证：

```text
“DeepSeek 最大的整页背景图是否适合加入项目”
```

完成并由用户验收后再决定是否继续：

```text
第二张深色背景
侧栏人物图
自定义上传
壁纸设置
主题包
```

未经用户验收，不进入这些后续功能。
