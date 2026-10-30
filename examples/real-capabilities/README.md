# 现成的 Filesystem MCP 与 frontend-design Skill

## 来源

- Filesystem MCP：Model Context Protocol 官方参考服务，提供文件读写、目录浏览、搜索和编辑能力。源码：https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem ，npm：`@modelcontextprotocol/server-filesystem`。
- frontend-design Skill：Anthropic 官方技能，提供网页界面的视觉设计和实现指导。源码：https://github.com/anthropics/skills/tree/main/skills/frontend-design ，目录内保留原始 SKILL.md 和 LICENSE.txt。

## 在 MoyuBot 中使用

1. 「设置 → MCP 与 Skills」导入本目录 `mcp.json` 的内容，然后测试连接。
2. 导入技能目录 `D:\dev\moyubot\examples\real-capabilities\frontend-design`。
3. 在 Bot 右侧详情启用 `Filesystem 文件管理` 和 `frontend-design`。
4. 发消息：

> 使用 frontend-design 技能，设计一个中文咖啡店首页。通过 Filesystem MCP 将完整 HTML 和 CSS 写入 D:/dev/moyubot/workspace/coffee-site/index.html。页面包含菜单、营业时间和地址，适配手机，不依赖构建工具。完成后用 MCP 重新读取文件检查，告诉我保存位置。

MCP 只能访问 `D:\dev\moyubot\workspace`；这里的 stdio 程序在本机运行，包括从云工作区 Bot 发起时。采用已安装的官方包和 Node.js 24，无需 API Key。技能本身提供方法，实际写文件由 MCP 完成。Bot 使用的模型需支持工具调用。

安装文件位于 `.work/real-capabilities/runtime`，清理该目录后需重新安装：

```powershell
npm install --prefix .work/real-capabilities/runtime --ignore-scripts --no-audit --no-fund @modelcontextprotocol/server-filesystem
```

若迁移电脑，更新 mcp.json 的 Node.js、程序和工作目录路径。Skill 按上游 LICENSE.txt 使用。
