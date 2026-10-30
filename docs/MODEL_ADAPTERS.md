# 多模型协议适配

模型响应由 pi-ai（`@earendil-works/pi-ai@1.4.0`）的三个适配器处理：OpenAI 兼容 Chat Completions、
Anthropic Messages、Gemini 原生协议。版本固定在 `packages/core/package.json`
和 `pnpm-lock.yaml`；升级时运行 `scripts/provider-sdk.test.mjs` 及相关回归测试。
许可证与归属见 [第三方声明](../THIRD_PARTY_NOTICES.md)。开发环境要求 Node.js 22.19.0 及以上。

`packages/core/src/providers/pi.ts` 把现有 `ChatProvider` 接口转换为 pi 的
消息格式，直接调用协议 `stream()` 与 `normalizeContext()`。pi 负责协议解析，MoyuBot 继续负责工具权限、
任务循环、MCP、技能、上下文压缩、任务预算、重试与取消。三个适配器均使用
`providerFetch`，沿用桌面端的系统代理或直连设置。Google SDK 通过每次请求独立的
本机随机路径转发端点接入该传输，请求结束即关闭；不修改全局 fetch 或代理环境。
只加载使用中的协议模块，不使用 pi 的账号发现、OAuth 或 Agent 运行时。

每次成功响应按顺序保存文本、思考、工具调用和签名元数据到 `modelTurns.replay`。
重载会话后，只为具有持久化结果的工具恢复调用记录。签名限定在原供应商 ID、
协议、接口地址和模型内使用；切换模型或接口时回退为普通文本与工具历史。
截断响应不保存可重放的签名块，也不执行其中的工具。

工具调用在收到完整结束事件且所有参数解析为 JSON 对象后统一交给任务循环。
断流、重复调用 ID、无效参数会报告错误；达到输出上限交由既有有界恢复逻辑处理。
未知的 Token 用量保留为未知，由任务预算按本次请求额度预留，不能当成零消耗。

历史摘要请求也使用当前模型和 Bot 的输出预算，包含模型思考所消耗的额度；
正文摘要长度另行检查。摘要截断时在任务总预算内提高请求额度并重新生成，
不会提交残缺 JSON 或推进历史游标。达到手动上限仍失败时，错误会明确标为
“历史摘要压缩未完成”，与正常聊天的输出截断区分。

摘要内容校验失败时，最多请求三次，并附上明确的格式纠正说明。
校验成功前不推进历史游标，也不把残缺内容当成长期记忆。
同步更新会话时保留活动对象引用，确保等待模型期间生成的摘要保存到当前会话；
重启后复用已验证的摘要与覆盖位置，历史没有增长时不会再次压缩同一段内容。
长任务可压缩当前运行中较早的完整工具调用与结果，保留原始用户请求和最近步骤；
运行内保存覆盖位置，下一轮复用摘要。完整工具历史继续落盘，任务摘要不修改
持久化会话游标，避免重启后跳过未覆盖记录。

接入新模型时仍需选择正确协议、填写接口地址与模型名，并按模型能力配置上下文、
输出与思考选项。SDK 不会让任意网关自动兼容所有参数；OpenAI Responses API、
供应商内置工具和模型服务端执行工具不属于当前这三个适配器的接入范围。

验证命令（先编译 core）：

```powershell
node node_modules/typescript/bin/tsc -p packages/core/tsconfig.json
node --test scripts/provider-sdk.test.mjs scripts/output-limits.test.mjs scripts/usage.test.mjs scripts/conversation.test.mjs scripts/capabilities.test.mjs scripts/schedules.test.mjs
```

协议夹具测试覆盖签名续接、切换模型、重载、异常断流、截断参数和网络传输。
它们不等于每个真实供应商与网关的在线兼容认证。
