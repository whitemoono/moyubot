# 同步数据清单（三端互通：桌面 ↔ 自托管服务器 ↔ 手机）

> 同步引擎已存在：客户端 `packages/core/src/sync.ts`（SyncClient：2s 轮询 + SSE 触发），
> 服务端 `apps/web/server/index.mjs`（SQLite：records + events 表，revision 递增，baseRevision 冲突裁决）。
> 什么数据能同步由**字段白名单**决定：`packages/core/src/sync.ts` 的 `SYNC_FIELDS`。

## 1. 现在就同步的（白名单内）

| collection | 同步字段 | 说明 |
| --- | --- | --- |
| `bots` | id, name, **dirName**, handle, avatar{shape,from,to,glyph}, model, providerId, systemPrompt, temperature, workspaceId, createdAt, updatedAt, sidebar | Bot 配置全量。**头像的形状+颜色随 bot 走**；`dirName` 是每 bot 工作目录名（本次新增） |
| `conversations` | id, botId, workspaceId, title, group, createdAt, updatedAt, deletedAt | 只同步会话元数据（标题/归属/删除标记），不含 summary/context |
| `messages` | id, conversationId, botId, botName, role, content, createdAt, model, error, stopped, streaming | 消息正文。注意：**不含 toolCalls/toolResults**（手机端看不到工具卡片详情） |
| `memories` | id, botId, text, pinned, createdAt, source | 记忆 |
| `schedules` | id, botId, title, prompt, cron, runAt, kind, enabled, createdAt, updatedAt, lastStatus, lastRunAt, nextRunAt, closedAt, completedAt | 定时任务（含状态；**执行仍归桌面/服务器端**，手机只读） |
| `profile` | userName | 用户昵称 |

子代理会话（`conv.subagent`）**永不外传**；合并/已删除会话（`mergedInto`）也不外传。

## 2. 不同步的（现状 + 是否该同步）

| 数据 | 现状 | 三端互通建议 |
| --- | --- | --- |
| 供应商配置 & API Key | ❌ 不同步 | **保持不同步**（密钥不该进同步库；手机端用服务器代理调用即可） |
| MCP 配置 + 认证 | ❌ 不同步 | 保持（stdio 绑定机器；云端 MCP 由云电脑自己管理）。远程执行走服务器代理 |
| Skills（文件） | ❌ 不同步 | 保持（机器绑定；手机端只看清单） |
| **头像自定义图片** `avatar.imageDataUrl` | ❌ **被 syncValue 剥掉** | **缺口**：手机要显示桌面端上传的头像。建议单开 `attachments` collection（base64，单张 ≤256KB，超过走文件接口），不要塞进 bots |
| 消息的 toolCalls/toolResults | ❌ 不在白名单 | 手机端 v1 可不做工具卡；要做再补精简版（name+summary，不带大输出） |
| todos / goals | ❌ 不同步（会话级、本地） | 手机端若要展示"目标 chip/清单"，加 `goals`/`todos` 两个 collection（字段少，成本低） |
| 会话压缩 summary/context | ❌ 不同步 | 保持（各端上下文独立，摘要可重算） |
| usage.jsonl / 诊断日志 | ❌ | 保持本地 |
| 工作区路径 / cloud 设置 | ❌ | 保持本地（每台机器不同） |

## 3. 每 Bot 工作目录（已实现 ✅）

**约定**：每个 Bot 在目标机器上有自己的文件夹，文件工具的**相对路径与命令 cwd 都锚定在那里**，实现 Bot 间文件隔离。

| 工作区 | 根（可配置） | Bot 文件夹 | 例子 |
| --- | --- | --- | --- |
| 云电脑 | `remoteWorkspaceDir`（设为 `/data/home/moyubot`） | `<root>/<dirName>/` | `/data/home/moyubot/大肥鱼/` |
| 本地 Windows | `workspaceDir`（如 `D:\dev\moyubot\workspace`） | `<root>/<dirName>/` | `D:\dev\moyubot\workspace\大肥鱼\` |

实现要点：
- `bot.dirName`：首次使用时由 `sanitizeDirName(bot.name)` 推导并**落盘**（改名不影响已生成目录）；同名 Bot 自动加 id 后缀避让；非法字符净化（`util.ts`）
- `cloud_exec` / `cloud_read` / `cloud_write` 通过 `ToolContext.botDir` → `exec/readText/writeText` 的 `subDirectory` 参数落到 `LocalHost`/`CloudHost`
- 逃逸保护：本地子目录必须仍在工作区内；云端目录由 `remoteDirectory()` 规范化
- 兼容：`subDirectory` 缺省时行为与旧版完全一致（共享根）；子代理临时 Bot 只推导不落盘

## 4. MCP / Skills 按 Bot 隔离

现状（✅ 盘点与部署已按 Bot 分流，见下"已实现"）：

```
/data/home/moyubot/<dirName>/          ← Bot 家目录（云端）
├── .claude.json                       ← 该 Bot 自己的 MCP 配置（Bot 对话里 install_mcp 写这里）
├── .claude/skills/<skill>/            ← 该 Bot 安装的技能（install_skill 写这里）
└── …（Bot 的工作文件）

D:\dev\moyubot\workspace\<dirName>\    ← 本地家目录（文件工具已锚定，见第 3 节）
└── .claude/skills/<skill>/            ← 本地技能目录约定（同云端）
```

已实现：
- **盘点**：探针枚举共享 `~/.claude*` + 每个 Bot 家目录的 `.claude*`，条目带 `botId/botDirName`；右侧栏按当前 Bot 过滤，共享项标"共享"、Bot 项标"云端"
- **部署分流**：Bot 在对话里 `install_mcp` / `install_skill` → 写该 Bot 家目录（自动建目录）；设置页的工作区级导入 → 仍写共享 `~/.claude*`（界面标"共享"）

待实现：
1. `load_skill` 物化到 `<botDir>/.claude/skills/<name>/`（按需复制，Bot 之间互不可见）
2. 执行时以 `HOME=<botDir>` 运行云端 Claude 类 agent（让 `.claude.json` 真正按 Bot 生效）
3. 本地 stdio MCP 按 Bot 启动（per-bot 连接池：`(serverId, botDir)` 键控，cwd/HOME 指向 Bot 家目录）
4. 共享项"提升为 Bot 专属"的 UI（把共享条目迁入某 Bot 家目录）

## 5. 冲突与语义（沿用现有引擎）

- 服务器赢：本地编辑基于过期 revision 时进 `conflicts`，保留完整本地副本供手动恢复（`restoreConflict`）
- 幂等：`changed(records)` 应用后才落 cursor，崩溃重放安全
- 子代理会话、密钥、执行副作用**永不过线**（同步层只搬便携数据）
