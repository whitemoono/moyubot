## 更新内容

### Bot 模板市场（本次核心功能）

**两套研发助手模板**
- **通用套**（内置发行版，任何项目可用）：代码评审官 / 测试守门员 / 文档管家 / 架构分析师 / 界面设计师 / 研发编排工头
- **moyubot 专用套**（远程市场提供，锚定本仓库）：伯乐 / 哨兵 / 策士 / 军师 / 妆画 / 工头

**客户端「设置 → Bot 市场」**
- 打开即展示全部可导入模板（内置通用 + 远程专用自动拉取，分组显示）
- 支持选择导入到**本地工作区或云电脑工作区**
- 从模板新建的 Bot 默认走「每次确认」（approvalPolicy = ask），可在 Bot 编辑页调整

**服务器侧**
- 官网市场展示页：https://moyubot.net/market.html
- 专用套远程索引：https://moyubot.net/bots/market-index.json

### 其他
- 模板导入/导出核心逻辑（`packages/core/src/bot-templates.ts`）+ 单测
- 存档：`docs/DEV-BOTS.md`、`docs/bot-template-market.md`

**Full Changelog**: https://github.com/whitemoono/moyubot/compare/v0.2.9...v0.3.0