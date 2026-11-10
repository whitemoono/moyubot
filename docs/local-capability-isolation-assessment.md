# 本地工作区 Skills/MCP 改造评估：对齐云电脑的按-Bot 隔离

状态：**评估**（未动代码）。目标：让本地工作区的 Skills/MCP 存储/展示与云电脑一致——每个 Bot 自己的 `.moyu/`（自有）+ 一个共享 `.moyu/shared/`，而不是现在的"全局数组 + 绑定"。

## 1. 现状对比

| 维度 | 云电脑（现状·目录隔离） | 本地（现状·全局共享） |
| --- | --- | --- |
| Skills 落点 | `<botDir>/.moyu/skills/`（自有）或 `.moyu/shared/skills/`（共享） | `<dataDir>/skills/<id>/`（全局单一目录） |
| MCP 落点 | `<botDir>/.moyu/mcp.json` 或 `.moyu/shared/mcp.json` | `settings.mcpServers[]`（JSON 数组） |
| 隔离 | 目录级（Bot 目录边界） | 靠 `workspaceId` 过滤 + Bot `skillIds/mcpServerIds` 引用 |
| 展示来源 | 云机盘点 `.moyu` 结构（`cloudServers/cloudSkills`） | 本机 `settings.skills/mcpServers` |

## 2. 要改成什么（目标模型）

本地也采用目录锚定：每个 Bot 在 `<dataDir>/local-artifacts/<botDir>/` 之外，增加 `<dataDir>/<botDir>/.moyu/`（自有技能/MCP）与 `<dataDir>/.moyu/shared/`（共享）。Skills/MCP 的归属从"settings 数组 + 引用"改为"目录存在 + 各 Bot 清单"。

## 3. 影响面（改动点清单）

这是一次**核心数据模型改造**，横跨 core 全层：

| 区域 | 涉及文件 | 改动 |
| --- | --- | --- |
| 能力存取 | `capabilities.ts` | `importSkill`/`importMcp`/`status`/`removeCapability`/`servers`/`skills`(485-486) 全部从"settings 数组"改为"本地 .moyu 目录读写 + 盘点" |
| 存储校验 | `store.ts:353-354` | `upsertBot` 的 mcp/skill 归属校验要从"settings.skills/mcpServers 引用"改为目录盘点 |
| Agent 绑定 | `agent.ts:735-762` | install 后自动绑定逻辑、读取方式 |
| 工具调用 | `tools.ts:891-1040` + 技能加载 | 本地技能读取路径、MCP 服务解析 |
| 数据结构 | `types.ts` | 可能需要新增本地 per-Bot 能力新形态（或复用 `cloudServers/cloudSkills` 那套盘点结构） |
| 工具安装入口 | `capabilities.ts:489-500` | 注入给模型的"能力安装落点规范"文案要加本地 `.moyu` 版本 |
| 渲染层 | `apps/desktop/src/views/CapabilitiesSettings.tsx` 等 | "MCP 与 Skills"页面的展示/绑定/来源标注 | 
| 迁移 | core 启动 or 首次读取 | 把已装到 `dataDir/skills/<id>` 与 `settings.mcpServers[]` 的存量迁到新目录结构 |

**粗略工作量**：跨 7+ 个模块、几十处读写点，含存量迁移与 UI 承载。属于"中型到大型"核心功能改造，不是小修。

## 4. 关键风险与权衡

1. **现有已装数据要迁移**：`dataDir/skills/` 下已装的技能、`settings.mcpServers` 已有 MCP，升级后必须迁移到新结构，否则已绑定的 Bot 失效。
2. **引用语义改变**：`skillIds/mcpServerIds` 从"引用全局数组条目 id"变为"引用目录清单"，Bot 模板导入（`bot-templates.ts` 里 skillIds/mcpServerIds 映射）和 `store.ts` 校验逻辑全要同步改。
3. **共享语义**:云电脑的 `.moyu/shared` 是显式目录；本地若引入同样机制，需要决定"共享技能/MCP"放哪、谁可读，和现有 `workspaceId=workspace_local` 的绑定如何兼容。
4. **回归面大**:技能/MCP 是 Bot 的核心能力，改动影响 240 个测试里涉及 capabilities/agent 的部分，需要配套改测试。

## 5. 建议的分步落地（如决定做）

1. **阶段 A（数据结构）**：定义本地 `local-<botDir>/.moyu` + `.moyu/shared` 目录约定与读写工具；`types.ts` 加入新形态。
2. **阶段 B（存取改造）**：`capabilities.ts` 的 import/status/remove/servers/skills 改为目录读写 + 盘点；本地不再依赖 `settings.skills/mcpServers`。
3. **阶段 C（Agent/工具/Store 接线）**：`store.ts` 校验、`agent.ts` 绑定、`tools.ts` 加载改用新模型。
4. **阶段 D（迁移）**：启动迁移把存量 `dataDir/skills/*` → 各/共享 `.moyu/skills/`；`settings.mcpServers` → 对应 `.moyu/mcp.json`；更新 Bot 绑定。
5. **阶段 E（UI）**：`CapabilitiesSettings` 展示"自有/共享"来源，对齐云电脑的展示。
6. **阶段 F（测试与回归）**:补迁移与隔离用例，跑满 240 测试。

每个阶段可独立验收，降低一次性大改的风险。

## 6. 结论

- 技术上完全可行，但工作量中等偏大、涉及核心数据模型与存量数据迁移，回归风险较高。
- 如果只是想"看起来像云电脑、更清楚",可以只做 **阶段 E（UI 来源标注）+ 阶段 D（把本地技能归档到 botDir 子目录）** 的轻量版，不做完整 per-Bot `.moyu` 目录隔离。
- 是否值得全量做，取决于"每个 Bot 真的需要目录级隔离"（互相看不见对方的技能/MCP）还是"只是想要更好的展示"。本地文件是同一台机器,隔离主要是语义与安全问题。

请确认方向后再启动对应阶段。