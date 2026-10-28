# 架构说明

MeshBot 分成两层：**`packages/core`** 是与 UI 完全无关的纯 Node 逻辑（供应商适配、Agent 循环、云主机编排、持久化、调度、Telegram），编译成 CommonJS 后被 **`apps/desktop`** 的 Electron 主进程直接引用；渲染层只通过 `contextBridge` 暴露的 `window.mesh` 与主进程通信。

```
apps/desktop/electron/main.ts     窗口、mesh-asset:// 协议、启动流程
                  /app.ts         MeshApp：所有 mesh:* IPC 的装配点
                  /preload.ts     contextBridge → window.mesh
apps/desktop/src/state.tsx        MeshProvider：bootstrap、事件归约、乐观更新、toast
              /views/*            聊天 / Bot / 云电脑 / 任务 / 设置
              /components/*       玻璃组件、标题栏、侧栏、检查器
              /styles/liquid.css  设计系统（唯一的样式来源）
packages/core/src/index.ts        对外 barrel
```

**重要约束**：渲染层只能 `import type` 自 `@mesh/core`。运行时导入会把 Node 内置模块带进浏览器产物，Vite 会直接报错。所有运行时数据都经 IPC 往返。

## 主进程装配（`MeshApp`）

`MeshApp` 在构造时创建并互相注入这些单例：

| 组件 | 职责 |
| --- | --- |
| `SafeSecretBox` | 用 Electron `safeStorage` 加解密，密钥存 `secrets.bin.json` |
| `Store` | `settings.json`、`conversations/*.json`、`memories.json`、`schedules.json` |
| `CloudHost` | 懒加载 driver，持有云主机状态机与空闲计时器 |
| `AgentRuntime` | 一次会话内的工具循环，事件以 `mesh:event` 推给渲染层 |
| `ScheduleRunner` | 30s tick，到点调 `AgentRuntime.runUnattended` |
| `TelegramGateway` | 长轮询，白名单过滤后转发给同一个 Agent |

密钥读取统一走 `keyProvider`：`CloudHost` 和供应商适配器都不持有明文 Key，每次用时才向 `Store` + `SecretBox` 索取。因此设置页保存 Key 后无需重启，`invalidateDriver()` 即可生效。

IPC 通道一览（全部 `ipcMain.handle`，命名空间 `mesh:`）：

```
bootstrap · settings:save · provider:key · provider:test · provider:models
telegram:token
bot:save · bot:delete
send · stop · approve
conversations · conversation · conversation:new · conversation:delete
cloud · cloud:action · cloud:exec · cloud:save
schedules · schedule:add · schedule:delete · schedule:toggle
memories · memory:add · memory:delete
artifact:open · open-external · win
```

主进程 → 渲染层只有两个单向事件：`mesh:event`（Agent 增量、工具开始/结束、审批请求）与 `mesh:cloud`（云状态变化）。

## Agent 循环（`agent.ts`）

一次 `send()` 的流程：

1. 取 `Bot` → 解析绑定的供应商 → 组装系统提示：Bot 人设 + 工具说明 + 该 Bot 的记忆条目。
2. 进入最多 `maxSteps`（默认 14）步的循环：
   - 调供应商流式接口，`onDelta` 逐字推 `assistant` 增量（含 `reasoning` 增量）。
   - 若返回 `tool_calls`：把 `assistant(tool_calls)` 与 `tool` 结果按规范化 `AgentMessage` 顺序压入历史，执行工具，继续下一轮。
   - 若没有工具调用：本轮结束，落盘。
3. 工具执行前过审批闸门：`bot.approvalPolicy === 'ask'`（界面上的「每次确认」）时通过 `ApprovalRequest` 阻塞等待 `mesh:approve`；`'never'`（自动执行）与 `'always'`（全部允许）都直接放行。被拒绝的结果以「用户拒绝」文本回灌给模型，而不是抛错中断整轮对话。
4. 全程 `try/finally` 保证 `stop()` 之后状态复位，且 `CloudHost.endTask()` 一定会被调用（否则会漏掉空闲挂起）。

`runUnattended()` 复用同一循环，但跳过审批（定时任务与 Telegram 场景），失败只记日志不弹窗。

## 云主机编排（`cloud.ts`）

`CloudDriver` 是抽象接口，两套实现：

- `InstaBoxDriver`：真正调 `instabox.ts`。
- `MockDriver`：纯内存模拟状态机，唤醒耗时 1.2–2.4s，用于无密钥演示与 smoke 测试。

`CloudHost` 负责策略而不是协议：

- `ensureAwake()`：已 `running` 直接返回；否则 `wake` 并轮询直到 `running`，超时抛 `InstaBoxError`。
- `beginTask()` / `endTask()`：任务计数 +1/-1；计数归零后按 `idleSuspendMinutes`（默认 3 分钟）武装本地挂起计时器。
- `armIdleIfNeeded()`：计时器触发时若仍无任务才真正 `suspend()`，给对话留出连续多轮工具的窗口。
- `resolveCloudState()`：把服务端状态与本地意图合并成 UI 用的 `CloudState`（含 `unconfigured` / `suspended` / `waking` / `running` / `error`）。

**唤醒规则是硬约束**：纯聊天不碰云主机。只有 `cloud_exec` / `cloud_read` / `cloud_write`，以及 `generate_image` 在 `image.backend === 'cloud'` 或 `image.wakeHost` 为真时才唤醒。

## 供应商适配（`providers/`）

三者共享同一个 `ChatProvider` 接口（`stream()` 返回异步增量序列 + 最终 usage）。差异被封在适配器里：

- `openai.ts`：`/chat/completions`，`stream: true` 的 SSE `data:` 行；支持 `tool_calls` 增量拼接、`reasoning_content`。
- `anthropic.ts`：`/messages`，事件类型 `content_block_delta` / `input_json_delta`，工具结果走 `user` 消息里的 `tool_result` 块。
- `gemini.ts`：`generateContent` + `streamGenerateContent?alt=sse`，`functionCall` / `functionResponse` 映射。

`sse.ts` 是一个手写的行级 SSE 解析器，容忍跨 chunk 截断与 `[DONE]`。

绘图单独一条路径 `generateImageWithProvider`：OpenAI 兼容走 `/images/generations`（兼容 b64 与 url 两种返回），Gemini 走 `generateContent` 要求 `responseModalities: ['TEXT','IMAGE']`。

## 工具（`tools.ts`）

| 工具 | 说明 | 是否唤醒云主机 |
| --- | --- | --- |
| `cloud_exec` | 在云主机跑命令，SSE 流式回传 stdout/stderr/exit | 是 |
| `cloud_read` | 读云主机文件（UTF-8 或 base64） | 是 |
| `cloud_write` | 写文件，自动建父目录 | 是 |
| `generate_image` | 按提示词出图并落盘到 `images/` | 取决于 `image.backend` |
| `remember` / `recall` | 写入/检索长期记忆 | 否 |
| `schedule_task` | 创建 cron 定时任务 | 否 |
| `web_fetch` | 抓取网页正文（截断后回灌） | 否 |

工具的输出不进入助手正文。早期版本把 stdout 接进 `onStream`，导致命令行回显混在回答里；现在 `ToolContext` 里没有流式回调，工具结果只以 `tool` 消息的形式回到模型。

所有产物路径都相对工作区，渲染时转成 `mesh-asset://local/<rel>`，由主进程注册的协议处理器经 `resolveArtifact()` 解析，避免渲染层拿到任意文件系统访问权。

## 持久化（`store.ts`）

纯 JSON 文件，无数据库。写入采用「临时文件 + rename」防止半截文件。`settings.json` **永不含密钥**；密钥单独加密存储，`providerSecretKey(id)` 是唯一键名生成处。`addMemory` 按 `botId + trim(text)` 去重。

## 调度（`scheduler.ts`）

`parseCron` / `nextCronTime` 支持标准 5 段表达式（分 时 日 月 周）。`ScheduleRunner` 每 30s 检查一次，命中就 `runUnattended` 并把 `lastRunAt` / `lastStatus` 写回，避免重复触发。

## 渲染层

`state.tsx` 里的 `MeshProvider` 是唯一的状态源：

- 启动时 `bootstrap()` 拿 `BootstrapPayload`。
- `send()` 先本地插入用户消息与占位助手消息（乐观更新），随后按 `mesh:event` 增量替换内容。
- 事件归约器同时维护云状态、工具运行列表、待审批请求与 toast 队列。
- 主题、强调色、玻璃浓度、密度都写成根元素 CSS 变量，切换主题只改 `data-theme`。

`liquid.css` 是单一样式来源：渐变底色、`backdrop-filter` 玻璃层、conic-gradient + mask 的 1px 高光描边、极光光斑、噪点覆盖、`--mx/--my` 光标辉光，以及 `prefers-reduced-motion` 与应用内「减少动效」双开关。

## 测试策略

`scripts/smoke.mjs` 在 `127.0.0.1:8791` 起一个假的 OpenAI SSE 服务，用 `MESH_DATA_DIR=.work/demo-data` 启动主进程级流程，断言：唤醒云主机 → 触发 `generate_image` → 产物落盘 → 二次回复。它不依赖任何真实 API Key，因此 CI 里可直接跑。
