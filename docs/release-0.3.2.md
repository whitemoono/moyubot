## 更新内容

### 修复启动黑屏
- 移除 `did-finish-load` 时过早显示窗口的逻辑：之前 HTML 解析完但 React 首帧未绘制就 `show()`，会短暂露出深色背景 + 应用图标。现在窗口仅在 `ready-to-show`（首帧已绘制）或 6 秒兜底后才显示，启动不再闪黑屏。

### 右侧检查器技能/能力折叠
- 本地工作区的 MCP 与技能在右侧检查器里改为**可折叠分组**（「自有 · 已启用」/「其它 · 可添加」），默认收起，点开才展开——技能一多也不再占满整块。

### 上版（0.3.1）摘要
- 本地技能归档到发起它的 Bot 的 `.moyu/skills/` + 存量迁移（幂等）
- Bot 工作目录支持绝对路径
- web_fetch 与模板市场共用出站 URL 守卫

**Full Changelog**: https://github.com/whitemoono/moyubot/compare/v0.3.1...v0.3.2