# Bot 模板市场

状态：**已实现·已部署**。目标是把「把 Bot 分享给别人用」做成安全、干净：**只分享配置与引用清单，不托管执行；每个导入方用自己的 provider 与 Key 计费**。

> **实现状态**（2026-11）：核心本地闭环 + 官网静态索引已落地，客户端内置通用套、远程市场托管专用套、支持本地/云工作区导入。详见文末 [实现与部署记录](#9-实现与部署记录)。

本文是 [BOT-MARKETPLACE.md](BOT-MARKETPLACE.md)（牛马市场/代跑调研，评估后不实现）收敛到"只做模板分享"后的落地设计。该文档第 5.1 节已明确：模板分享"只需要前端 + 一个静态索引服务，风险量级完全不同"——本方案就是它的展开。

关联文档：[研发 Bot 组设计](DEV-BOTS.md) · [路线图](ROADMAP.md) · [架构](ARCHITECTURE.md)

---

## 0. 范围与边界（先划清）

| 能力 | 做不做 | 原因 |
| --- | --- | --- |
| **模板市场**（分享 Bot 配置） | ✅ 做 | 用户自己的 Key 计费，平台不托管执行 |
| 额度中转（平台替你跑模型） | ❌ | 平台 Key / 账单 / 封号 / 合规，需账本 |
| Agent 代跑（托管别人的 Bot 在主人机器执行） | ❌ | 责任不可封顶，BOT-MARKETPLACE 已否掉 |

一句话：**只分享"人设+配置+工具/Skill 引用"，导入方在自己设备用自己的 Key 跑**。

## 1. 两种页面形态（职责分工）

### 1.1 官网 Bot 市场页（面向所有人）

职责是「发现 + 上传」，承载公共目录：

- 浏览/搜索模板库，每张卡片显示：人设预览、需 Skill/MCP 清单、作者、标签、导入次数。
- **上传入口**：用户提交自己的 Bot 模板，进入审核流。
- 对接官网登录/身份系统；产出的是**已审核的模板索引**。

### 1.2 客户端设置页 Bot 市场（面向当前用户）

职责是「导入/我的 + 本地生效」，承载用户侧动作：

- 从官网/本地模板库**拉取 → 搜索 → 导入**到自己工作区。
- 「我上传过的模板」：状态（审核中/已上架/被拒）、被导入次数、下架。
- 「已安装模板」：查看、升级到新版、卸载。
- **关键安全动作在导入一侧生效**：导入默认 `ask`、引用确认、Skill/MCP 选择（见 §4）。

> 参考：`BOT-MARKETPLACE.md` §5.4 曾设计过"设置页新增『牛马市场』分区"（积分钱包/上架/打工近况/流水/发现五块）。那是为**代跑+积分**设计的，本方案**不需要积分钱包与链上那套**，只取其中「发现 + 我上传的」两块。

## 2. 模板 Schema

对齐 `Bot` 结构与 `packages/core/src/sync.ts:3` 已白名单化的字段：

```ts
interface BotTemplate {
  schemaVersion: 1;           // 校验/迁移用
  meta: {
    name;                     // 展示名（≠ 导入后的 Bot 名，导入时可改）
    handle;                   // 唯一标识，snake-case
    author;                   // 作者署名
    locale;                   // 'zh-CN'
    tags: string[];
    description;
    version;                  // 模板自身版本，导入方据此判断升级
    examplePrompt?;           // 建议首条对话
  };
  bot: {
    systemPrompt;             // 人设
    temperature;
    generation?;              // 生成与任务预算
    image;                    // 绘图配置
    workspaceId;              // 建议，导入方以本地为准
    wakeOnTask;
    // 工具/Skill/MCP 只用「引用清单」，不随包带内容：
    tools: string[];          // 建议工具；导入后默认全开、按需调用
    skillNames?: string[];    // 需要哪些 Skill（名称，导入方自行挑选绑定）
    mcpServerIds?: string[];  // 需要哪些 MCP（名称，导入方自行挑选绑定）
    // 定时任务：仅作「建议」声明，导入时不自动注册
    suggestedSchedules?: { title; prompt; rrule }[];
  };
}
```

**绝不携带**：API Key / secret、记忆正文、对话历史、本机或云端路径、可执行脚本本体。

## 3. 用户上传 → 官网索引流程

1. **导出**：设置页 Bot 编辑 →「分享为模板」→ 校验打包为 `BotTemplate` JSON（含 schemaVersion）。
2. **上传**：填标题/标签/描述 → 提交到官网后端（身份 + 去重 + 版本号）。
3. **审核**：进待审队列 → 运营审核 → 落地静态索引。**这一步不可省**（模板是代码体，见 §4）。
4. **发现/导入**：官网搜索/浏览 → 导入方在自己的工作区用 `newBot(seed)` 新建，用自己的 provider/Key 计费。

## 4. 安全护栏（最小可用，不做流程）

**模板本质是 "prompt injection 载体"**——人设 + Skill 引用 + 工具开关合起来能诱导执行任意命令。安全目标是「**不是不让它用，而是它不能自己无声地跑**」。护栏只有一条 + 几处引用控制，不引入任何导入向导：

1. **导入默认 `ask`**：导入后的 Bot，`approvalPolicy` **强制设为 `ask`**，绝不继承模板声明的 `never`——防止模板让工具无审批自动执行。这**不缩功能**：写类工具全开，只是执行前弹一次确认。用户觉得麻烦，可在设置页手动调回 `never`，这是用户自己的决定，模板无法声明。
2. **引用需确认**：模板声明的 `skillNames` / `mcpServerIds` 只做清单展示，导入方逐个勾选绑定；不自动安装、不自动启用。
3. **`workspaceId` 以本地为准**：模板声明只是建议，导入跟随当前工作区类型。
4. **定时任务不自动注册**：`suggestedSchedules` 仅展示，导入方确认后才建。

即：**缩权 = 默认要审批，而不是禁用或阉割功能**。工具全开、按需调用；真正让用户放心的开关只有一个 `approvalPolicy`，一句话放进设置页就够，不做流程。

## 5. 无官网后端的过渡方案（可先行）

暂不搭后端也能先验证闭环：

- 项目内置 `presets/*.json` 模板目录（首批放 `DEV-BOTS.md` 的 6 个研发 Bot）。
- 客户端「从模板新建 Bot」读目录导入，§4 的「默认 `ask`」规则直接生效。
- "上传到官网市场"留到本地闭环与安全规则验证通过之后再上。

## 6. 落地顺序建议

1. **本地闭环**：`presets/` 目录 + 设置页「从模板新建 Bot」（导入默认 `ask`）。
2. **官网静态索引**：托管 JSON 模板列表 + 官网市场页展示 + 客户端拉取/搜索/导入。
3. **上传 + 审核**：提交 → 审核 → 进索引。有审核环节才开放上传。

## 7. 待决策项

| 问题 | 说明 |
| --- | --- |
| 是否允许模板"建议工具集"含 `install_*` | 建议第一版不允许，安装能力是敏感入口 |
| 官网是否需要身份才能上传 | 建议需要；浏览可匿名 |
| 模板升级策略 | 导入方是自动升级还是显式升级，需 UI 决策 |

## 8. 与既有文档的衔接

- 本方案是 `BOT-MARKETPLACE.md` 第 5.1 节的落地，**不是**第 5.2/5.3 的代跑或中转方案，二者不可混同。
- `ROADMAP.md` §0.4 已列「Bot 模板市场：人设 + 工具集 + 定时任务的组合可导出为 JSON」，本方案与之一致。
- 参考 `packages/core/src/sync.ts:3` 的导出白名单，模板不引入 secrets。

## 9. 实现与部署记录

> 2026-11 落地。以下对应实际代码，供后续维护参考。

### 9.1 代码位置

| 职责 | 位置 |
| --- | --- |
| 模板类型 / 导出 / 导入 / 校验 / 强制 ask | `packages/core/src/bot-templates.ts` |
| 内置「通用研发助手」预设 | `packages/core/src/presets.ts`（`GENERAL_BOT_PRESETS` / `BUILTIN_BOT_PRESETS`） |
| 我上传的模板记录持久化 | `Store.botMarket()` 等（`packages/core/src/store.ts`） |
| 市场 IPC（预设/导入/导出/远程/上传/移除） | `apps/desktop/electron/app.ts`（`moyu:market:*`） |
| 市场 UI（设置 → Bot 市场） | `apps/desktop/src/views/BotMarketView.tsx` |
| 客户端默认远程索引 URL | `apps/desktop/src/lib/market.ts`（`MARKET_INDEX_URL`） |
| 单测 | `scripts/bot-templates.test.mjs` |

### 9.2 两套预设的取舍

- **通用套**（6 个：代码评审官/测试守门员/文档管家/架构分析师/界面设计师/研发编排工头）：内置在安装包，对所有用户开放。
- **moyubot 专用套**（6 个：伯乐/哨兵/策士/军师/妆画/工头，锚定本仓库硬约束）：**不内置在发行版**，作为远程模板提供，只有从远程市场源拉取的人能看到。

### 9.3 部署

- 远程市场索引：`https://moyubot.net/bots/market-index.json`（托管于服务器 `moyubot-landing` 容器的 `/usr/share/nginx/html/bots/`，同时写入部署源 `/opt/moyubot-landing/site/bots/`，重建不丢）。
- 客户端启动「设置 → Bot 市场」即自动拉取该索引并入展示（静默降级），无需手动拉取。
- 导入支持「导入目标工作区」下拉（本地/云电脑工作区），模板 `approvalPolicy` 导入时强制 `ask`。

### 9.4 开发注意（易踩坑）

- 改了 `apps/desktop/electron/*.ts`（IPC / 主进程）后，`pnpm dev` 不会重编译主进程，必须 `pnpm --filter @moyu/desktop exec tsc -p tsconfig.electron.json` 再重启才生效（详见 [ARCHITECTURE.md](ARCHITECTURE.md) 开发提示）。
- 远程模板经 `moyu:market:remote` 用 Electron `net.fetch` 走系统代理；跨域由 CSP 的 `connect-src` 约束。