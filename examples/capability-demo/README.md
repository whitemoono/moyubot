# MCP 与 Skill 测试样例

无需 API Key 或网络服务，使用当前项目已安装的 MCP SDK 和本机 Node.js。

1. 在 MoyuBot「设置 → MCP 与 Skills」中，粘贴同目录 `mcp.json` 的完整内容并导入。
2. 点击「测试连接」，应显示已连接、2 个工具：`echo` 和 `add_numbers`。
3. 点击「导入技能目录」，选择 `D:\dev\moyubot\examples\capability-demo\moyu-capability-check`。
4. 在当前 Bot 右侧「详情」中，启用「MoyuBot 测试」和 `moyu-capability-check`。
5. 发消息：`使用 moyu-capability-check 技能，测试 MCP 与 Skill 联动，给我验收结果。`

预期会读取 SKILL.md、读取参考文件，调用 echo 和 add_numbers，返回校验短语、17 + 25 = 42 和真实调用时间。右侧应显示 MCP 的两个工具以及技能最近加载时间。Bot 设置为执行前确认时，需要同意 MCP 调用。

如果项目移动到其他路径，更新 mcp.json 的 server.cjs 路径；如果 Node.js 安装路径不同，更新 command。此样例服务只处理输入文本和数字，不读写业务文件。

开发验证命令：`node examples/capability-demo/verify.mjs`。
