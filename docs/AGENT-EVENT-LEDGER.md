# Agent 运行事件账本与可追溯工作空间设计

状态：草案（2026-11-09）。本文提出 MoyuBot 下一阶段的核心架构升级：在现有 Conversation Store / Memory Store 之上，**旁路增加一份 append-only 的 Agent 运行事件账本**，并据此把三个差异化能力（可追溯、可续航、可分支）逐层落地。

本文区分「已存在的基础」与「本设计新增」，并明确**不做什么**，避免演变成重写。

---

## 1. 背景与目标

### 1.1 现状（已存在的能力）

MoyuBot 现在已经有相当完整的 Agent 循环，以下都是**基础，不是包袱**：

- 真正的 Agent 循环（25 个内置工具、审批、计划模式、上下文压缩与工具瘦身）。
- 目标续航：`set_goal` + `until_done` 续航模式 + `todo_write` + `ask_user`。
- 子代理：`spawn_agent`（只读、不继承历史）、`subagent_fork`（带上下文只读分身）、`run_script`（`agent()/parallel()/pipeline()` 编排）、`job_list/job_kill`。
- 三层上下文：原始聊天 / 对话摘要 / 长期记忆（见 `docs/LONG-TERM-MEMORY.md`）。
- 运行期事件广播：`AgentEvent`（`packages/core/src/types.ts:523`），经 `this.emit()` 推给前端 UI。
- 持久化：会话以 JSON 文件为主存储（`store.ts` `saveConversation` → `writeJsonAtomic`）；长期记忆用单文件 SQLite（`packages/core/src/memory-store.ts`，`node:sqlite`）。

### 1.2 缺口

| 能力 | 缺口 |
| --- | --- |
| 可追溯 | `AgentEvent` 只广播不落盘；上下文压缩后早期过程细节永久丢失，只剩摘要 |
| 可续航 | 有「重启标记中断」，但不知道中断在哪一步、哪些工具执行到一半；存在崩溃后误重放副作用操作的风险 |
| 可分支 | 子代理结论只回一段文本，无法重开、比对证据、审计 |

### 1.3 目标（三条差异化能力）

1. **可追溯（Traceable）**：知道以前做过什么、为什么这样做、依据是什么。
2. **可续航（Resumable）**：崩溃、重启、切换模型之后能恢复未完成工作，且**绝不重复执行已经发生的副作用**。
3. **可分支（Branchable）**：同一任务可并行探索不同方案，把结论与证据结构化带回主时间线。

### 1.4 非目标（本期明确不做）

- 不把 JSON 会话文件废弃、不改成「账本为唯一真相源」。
- 不引入 rutis / 跨语言插件运行时 / 自研插件执行协议 / 插件热加载。
- 不做 Dim 式「同一 `我` 全功能分神」（分支可写共享工作区）。
- 不落盘逐 token 的 `delta` / `reasoning` 流（体积爆炸，前端广播已有）。

---

## 2. 架构总览

```
                     ┌──────────────────────────────┐
                     │        Agent Runtime          │  模型调用 · 工具执行
                     │   （现有 agent.ts，基本不动）    │  用户审批 · 子任务
                     └───────────────┬──────────────┘
                                     │
          ┌──────────────────────────┼───────────────────────────┐
          │ 主路径（真相源）           │ 主路径（信息源）            │ 旁路 · 单向
          ▼                          ▼                            ▼
 ┌────────────────────┐   ┌────────────────────┐      ┌──────────────────────────┐
 │ Conversation Store │   │    Memory Store     │      │      Event Journal        │
 │  JSON 会话文件       │   │  SQLite memories.db │      │  SQLite events.db         │
 │  消息/快照/上下文     │   │  长期记忆/来源/检索   │      │  运行事件 · executionId    │
 └────────────────────┘   └────────────────────┘      │  · branch.result_committed │
                                                       └──────────────┬───────────┘
                                                                      │ 启动时反向查询
                                                                      ▼
                                                          恢复 · 历史检索（只读消费）
```

### 2.1 关键原则：账本是旁路单向，不驱动主路径

- **会话与记忆照常写**，行为与今天完全一致；账本只是在关键点**额外记录一份**。
- **账本写入失败不影响主流程**（`journalSafe` 统一 try/catch，记 warn，绝不抛）。
- 账本**只被读取用于恢复与检索**，从不反向驱动 Conversation / Memory 的写入，避免耦合与「账本一挂全挂」。
- 这决定了崩溃时最坏结果只是「账本少记一条」，而不会「聊天不工作」。可追溯/可续航的价值在于**对副作用工具执行的安全恢复**，而非精确复刻每条消息。

---

## 3. 核心决策：为什么是「JSON 主存储 + 旁路账本」

评估过三种架构：

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| A. 账本为唯一真相源，JSON 为投影 | 最"纯粹"的事件溯源 | ✗ 需重写所有 `appendMessage/saveConversation` 调用方，风险高 |
| B. JSON 主存储 + 旁路 append-only 账本 | 会话行为不变，额外记审计/恢复日志 | ✓ **采用** |
| C. 不用 SQLite，多用几个 JSON 文件 | 无新依赖 | ✗ 按 run/type/时间段查询与事务差，无法支撑恢复与检索 |

选 B：复用现有 `node:sqlite`（零新增原生依赖），独立 DB 文件 `events.db`，与 `memories.db` 分开避免抢锁。

---

## 4. 数据模型

### 4.1 事件记录

```ts
export interface AgentEventRecord {
  eventId: string;        // 'evt_xxx'
  seq: number;            // 全局单调递增（DB AUTOINCREMENT）
  conversationId: string;
  botId: string;
  runId: string;
  type: string;           // 见 §4.2
  timestamp: number;
  schemaVersion: number;  // 从 1 起，向后兼容加字段
  executionId?: string;   // 副作用工具的幂等键（仅 tool.* 事件）
  payload: unknown;       // JSON 序列化
}
```

### 4.2 事件类型（首期）

| 事件 | 触发点（现有代码） | payload 关键字段 |
| --- | --- | --- |
| `run.started` | `agent.ts:244 / 294 / 1150` 的 `emit run_start` 旁 | botId, kind: user/group/autonomy/subagent |
| `message.received` | `appendMessage(userMessage)` 旁 | messageId, text 摘要 |
| `model.response.completed` | usage 更新后（`agent.ts:522` 附近） | messageId, model, usage, hasToolCalls |
| `tool.call.requested` | `emit tool_start` **之前**（`agent.ts:535`） | name, callId, `executionId` |
| `tool.approval.decided` | `requestApproval` 返回后（`agent.ts:541`） | executionId, approved |
| `tool.execution.started` | 审批通过、`runTool` 调用前 | executionId, sideEffect |
| `tool.execution.completed` | `emit tool_end` 前（`agent.ts:809`，ok 分支） | executionId, ok, summary, detail 摘要 |
| `tool.execution.failed` | `agent.ts:809` ok=false / catch 分支 | executionId, error |
| `context.compacted` | 上下文压缩前后（`context.ts:376` 附近） | beforeTokens, afterTokens |
| `branch.result_committed` | 子代理结束时（`agent.ts:948/997/1073` 附近） | branchId, conclusion, evidence[], status |
| `run.completed` | `emit run_end` 前，ok=true（`agent.ts:867`） | |
| `run.interrupted` | run_end ok=false / abort / 崩溃恢复 | error, paused, reason |

> 说明：`AgentEvent`（UI 广播）与本账本事件是**两套并行结构**。账本事件不替代 UI 事件，二者在不同层，互不改动。首期不建议记 `delta`/`reasoning` 逐 token 流。

### 4.3 存储实现要点

```ts
CREATE TABLE IF NOT EXISTS agent_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  eventId TEXT NOT NULL UNIQUE,
  conversationId TEXT NOT NULL,
  botId TEXT NOT NULL,
  runId TEXT NOT NULL,
  type TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  schemaVersion INTEGER NOT NULL,
  executionId TEXT,
  payload TEXT NOT NULL
);
CREATE INDEX idx_evt_conv ON agent_events(conversationId, seq);
CREATE INDEX idx_evt_run  ON agent_events(runId, seq);
CREATE INDEX idx_evt_type ON agent_events(type, timestamp);
CREATE INDEX idx_evt_exec ON agent_events(executionId);
```

- `PRAGMA journal_mode = WAL`、`synchronous = NORMAL`（与 memory-store 一致）。
- 代码文件：`packages/core/src/event-journal.ts`，`class EventJournal`，导出 `append / unsettledExecutions / timelineSearch / recover / close`。

---

## 5. 幂等与崩溃恢复（最核心）

### 5.1 副作用工具才需要幂等键

只对会改变世界的工具生成 `executionId`：`cloud_exec` / `cloud_write` / 文件写 / `apply_patch` / 桌面操作 / 发消息类。纯读工具（`cloud_read`、`web_search`、`recall`…）不加——重放无害，加了只增噪音。在工具注册表上增加 `sideEffect: boolean` 标记。

> 幂等键用独立 `execId = newId('exec')`，**不复用模型给的 `call.id`**（模型可能重发相同 call.id）。

### 5.2 严格写入顺序

```
1. tool.call.requested      (status=requested, 带 executionId)
2. tool.approval.decided    (若需审批)
3. tool.execution.started   (intent：我即将执行；必须早于真正执行落盘)
4. await runTool(...)       (真正执行)
5. tool.execution.completed / failed
```

**第 3 步必须先于第 4 步落盘**，这样崩溃后能区分：

- 有 `started` 无 `completed` → **执行到一半，结果未知 → 标记需人工核对，绝不自动重放**；
- 有 `requested` 无 `started` → 尚未执行 → **安全，可重试**。

### 5.3 恢复流程（启动时）

`EventJournal.recover(conversationId)`：

1. 逐 `runId` 取最后一条事件；
2. 若最后是 `run.started` / `tool.execution.started`（缺 `run.completed/interrupted`）→ 判定为未正常结束的运行；
3. 对 `unsettledExecutions()` 中：
   - 有过 `started` 的 → 补写 `tool.execution.failed{reason:'unknown_after_crash'}` + `run.interrupted`，会话标 `needsReview=true`；
   - 只有 `requested` 的 → 补写 `run.interrupted`，提示用户「上次任务中断，是否继续」；
4. **恢复只写账本、不自动重跑任何工具**。续跑交给现有的 `set_goal` / `until_done` 续航暂停机制，账本只提供「上次做到哪」的准确依据。

### 5.4 工具侧兜底

工具实现第一步查 `journal.hasExecution(execId)`：若已有 completed → 直接返回缓存结果，不再执行。极少数重放场景也能兜底。

---

## 6. 可追溯：Timeline Search（P1）

### 6.1 独立工具，不合并现有 recall

保留 `remember()` / `recall()`（面向长期记忆），新增面向历史的 `timeline_search`：

```ts
timeline_search(
  query,
  conversationId?,
  timeRange?: { from?: number; to?: number },
  eventTypes?: string[],
  botId?,
  limit?
)
```

### 6.2 返回与原则

- 返回：`eventId`、时间、类型、来源、摘要、原文引用（**不注入为系统指令**）。
- **历史是证据，不是系统指令**：搜索结果作为资料块返回，模型可引用，但不得升级为新的系统提示。
- 典型用途：用户问「我之前考虑过哪些云电脑供应商？」→ 从 timeline 找出当时研究的供应商、时间、价格、排除原因、最终决定。

### 6.3 与记忆的边界

- `recall` → 语义召回**提炼后的事实**（进系统提示注入）。
- `timeline_search` → 结构召回**原始事件**（当参考资料，不升级指令）。
- 二者不合并，避免绕开记忆层的凭据过滤、版本冲突、注入防护。

---

## 7. 可分支：结构化结论回传（P3）

### 7.1 只做「只读并行 + 结构化结论」

- 分支拓扑：Main Agent → 多个只读 Branch（各带独立 `runId` 写同一账本）→ 汇总。
- **不做分支可写共享工作区**：在单工作区下分支会与主 Agent、彼此互相踩文件/命令，是真实坑。只读并行是唯一稳妥形态，也恰好符合调研/选型类任务。
- 落地对象：`spawn_agent` 与 `subagent_fork` 的已有只读分身。

### 7.2 `branch.result_committed` 事件

子代理结束时，除返回文本外，向账本写一条结构化事件：

```ts
runId:        <branch 的 runId>
type:         'branch.result_committed'
payload: {
  branchId, parentConversationId,
  conclusion: string,
  evidence: { eventId?, messageId?, ref?: string }[],
  status: 'ok' | 'error',
  startedAt, endedAt
}
```

主 Agent 汇总时读账本里各 `branch.result_committed`，比较证据、形成决策。好处：分支可重开、结果可更新、历史可回溯、决策可审计。

---

## 8. 与记忆层的连接（P2）

`memories` 表当前仅有 `id/scopeId/text/pinned/source/createdAt/lastUsedAt/embedding/embeddingModel`（见 `memory-store.ts:17`）。本期**增量**增加：

```sql
ALTER TABLE memories ADD COLUMN sourceMessageIds TEXT;  -- JSON 数组
ALTER TABLE memories ADD COLUMN sourceEventIds   TEXT;  -- JSON 数组（指向账本 eventId）
```

整理记忆时把来源消息对应的 `eventId` 一并写入。这样：

- 用户纠正旧信息时可回到来源；
- 记忆冲突时可比来源与时间；
- 删除错误记忆时明确删的是提炼结果而非原始聊天；
- 回答涉及历史事实时可给出依据。

`MemoryFact` 增字段 `sourceMessageIds?: string[]; sourceEventIds?: string[]`。此步可选、低风险，使 P2 变成纯增量。

---

## 9. 写入挂载方式（最小侵入）

- `Agent` 构造时注入 `journal: EventJournal`。
- 业务点用薄封装 `journalSafe(type, payload, executionId?)` 写账本，内部 try/catch，失败仅 `emit log warn`。
- **不改现有 `emit` 语义**，只在对应业务点旁增加一次 `journalSafe` 调用。
- 改动主要集中在 `agent.ts` 的工具执行循环（`agent.ts:533` 起）与 run 生命周期（`run_start` / `run_end` 处），`context.ts` 压缩点一处。

---

## 10. 治理、配置与兼容

- **零迁移**：`events.db` 为新文件，旧会话/记忆不受影响；历史数据「从此刻开始记录」。
- 配置开关：`AppSettings` 增加 `eventJournal: { enabled: boolean }`，默认开；关闭时 `journalSafe` 直接 return（逃生舱）。
- 数据治理：启动时 `PRAGMA wal_checkpoint`；保留策略——90 天前且所属 run 已 `completed` 的非工具事件定期清理；工具执行事件永久保留（体积小、审计价值高）。可按 `conversationId` 导出 JSONL 归档，风格对齐现有 Markdown 备份。

---

## 11. 分阶段实施与验收

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| P0-a | `event-journal.ts` + 仅 3 个事件（`run.started` / `tool.call.requested` / `tool.execution.completed`）端到端 + 测试 | 账本可查、seq 递增、不影响聊天 |
| P0-b | executionId 幂等 + `started` 先落盘 + `recover` | 拔电源重启：有 `started` 无 `completed` 的副作用不重放 |
| P1 | `timeline_search` 工具 | 能按 run/时间/type 检索；历史作为证据不升级指令 |
| P2 | Memory `sourceEventIds` 关联 | 记忆可追溯到具体事件；删除不影响原始聊天 |
| P3 | `branch.result_committed` 结构化回写 | 主 Agent 能读分支结论做决策；分支可回溯 |

### 11.1 测试计划（`scripts/event-journal.test.mjs`，对齐现有 test 风格）

1. 基本写入：各类事件按 runId/conversationId 可查，seq 递增；
2. 幂等：同 `executionId` 重复 completed 不重复插入（UNIQUE）；
3. 崩溃恢复：构造 `requested→started` 无 completed，`recover` 后产生 `unknown_after_crash` + `needsReview`；
4. 不重放：`unsettledExecutions` 只含 `started` 类；`requested`-only 可重试；
5. 过滤：`timelineSearch` 的 type/time/conversation 过滤正确；
6. 失败不影响主流程：DB 锁定时 `journalSafe` 不抛，`send_message` 仍成功。

`package.json` 增 `"test:journal"`。

### 11.2 工期估算

约 1.5 人日（P0），P1/P2/P3 各约 0.5–1 人日增量。

---

## 12. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 账本与 JSON 双写不一致 | 旁路单向，账本非真相源；不一致仅影响审计粒度，不影响聊天 |
| 事件表膨胀 | 90 天清理 + 工具事件永久保留 + JSONL 归档 |
| 副作用误重放 | `started` 先落盘 + `executionId` 幂等 + 恢复不自动重跑 |
| 分支并写冲突 | 仅做只读并行分支，不做可写共享工作区 |
| SQLite 锁竞争 | 独立 `events.db`，WAL，不与 `memories.db` 共用 |

---

## 13. 一句话验收标准

> 任意时刻拔电源，重启后：**每一笔已发生的副作用工具执行，账本里要么同时有 `started` + `completed`，要么被明确标记「未知需核对」；永不因账本记录缺失而重复执行删文件 / 写文件这类操作。**
