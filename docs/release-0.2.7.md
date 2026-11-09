## 更新内容

### 分层长期记忆（Layered Long-term Memory）

- **History Search**：新增 `history_search` 工具，按语义检索历史对话（关键词 + 向量 + 时间衰减融合），比 `recall`（只搜记忆条目）覆盖面更广
- **Project State**：新增 `project_list / project_upsert / project_switch`，让 Bot 记住项目级状态（当前在做哪个项目、进展到哪一步）；切换项目时自动带上对应上下文
- **增量记忆整理**：每 8 轮对话 + 2000 tokens 触发一次自动提炼（不阻塞当前回复），把成功的动作与结论沉淀成记忆，失败的尝试不进记忆
- **存储**：SQLite 落盘（会话历史 / 项目状态 / 记忆），向量检索可选接入 BGE-M3

### UI

- 一键跳回底部按钮
- 记忆存储面板：能看到当前占用的条目数与体积
- 向量嵌入卡片：显示 BGE-M3 是否可用、检索命中情况

### 测试

51/51 通过（history / project / consolidation / memory / tool-regression）

**Full Changelog**: https://github.com/whitemoono/moyubot/compare/v0.2.6...v0.2.7