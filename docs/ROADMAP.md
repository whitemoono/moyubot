# 路线图

当前版本：**0.1.0 — Windows 桌面端可用**。

## 已完成（0.1）

- [x] pnpm workspace：`@moyu/core`（纯逻辑，CJS）+ `@moyu/desktop`（Electron + React + Vite）
- [x] 供应商适配器：OpenAI 兼容 / Anthropic 原生 / Gemini 原生，含流式与工具调用
- [x] 绘图：OpenAI `/images/generations` 与 Gemini `responseModalities`，产物落盘 + `moyu-asset://` 协议渲染
- [x] Agent 循环：14 步上限、8 个工具、审批闸门、停止/中断
- [x] 云主机：InstaBox 驱动（唤醒、执行、文件读写、自动挂起）+ 离线 Mock 驱动
- [x] 按需唤醒策略：纯聊天不唤云，空闲计时器 + 服务端 `autoSuspendAfterSeconds` 双兜底
- [x] 长期记忆（按 Bot 隔离、去重、注入提示词）与 cron 定时任务（无人值守）
- [x] Telegram 长轮询网关 + 白名单（fail closed）
- [x] 液态玻璃 UI：明暗主题、自定义强调色、玻璃浓度、密度、减少动效
- [x] 密钥加密存储（Electron `safeStorage`，与 `settings.json` 分离）
- [x] smoke 测试脚本（假 OpenAI SSE 服务，全链路无密钥可跑）

## 下一步（0.2 — 打磨）

- [ ] 对话内编辑/重发、分支重试（resend / regenerate）
- [ ] 消息级产物面板：图片、命令输出、文件树可点击预览
- [ ] 多会话并行运行与后台任务栏（当前同一时刻只跑一个 Agent）
- [ ] 云主机文件浏览器（列目录、上传、下载、拖拽）
- [ ] 用量与成本面板：按 Bot / 供应商统计 token 与唤醒时长
- [ ] 打包验证：`pnpm dist` 出 NSIS 安装包 + 自动更新（electron-updater）
- [ ] 应用图标与首次启动向导（选供应商 → 填 Key → 连云主机）
- [ ] CI：typecheck + build + smoke 三件套

## 0.3 — 平台扩展

- [ ] **macOS**：`electron-builder --mac`（dmg，arm64 + x64），标题栏改用原生 traffic lights，`safeStorage` 走 Keychain
- [ ] **Android**：共享 `@moyu/core` 的协议层太重（依赖 Node 内置），计划拆出 `@moyu/protocol`（纯 TS、无 IO），用 Capacitor 或 Tauri Mobile 承载 UI
- [ ] **iOS**：与 Android 共用 `@moyu/protocol`，UI 复用同一套设计变量
- [ ] 移动端定位为「遥控器 + 审批端」：发指令、看进度、点批准，重活仍在云主机

## 0.4 — 生态

- [ ] 云主机驱动可插拔：Fly Machines、Daytona、E2B、自建 SSH/容器
- [ ] MCP 客户端支持（stdio + SSE），把外部工具集接进 Agent
- [ ] 子 Agent 编排：一个 Bot 派生受限子任务，独立上下文
- [ ] Bot 模板市场：人设 + 工具集 + 定时任务的组合可导出为 JSON
- [ ] 更多通道：Discord、Slack、邮件摘要

## 模型额度互助市场（设计中）

开发方案见 [MoyuChain / 模型额度互助市场开发文档](MOYUCHAIN-DEVELOPMENT.md)。范围收敛为模型 Key 对应调用额度的共享，采用匿名钱包身份和模型用量积分结算，不收平台费或 Bot 服务费。市场不依赖任务云电脑，不提供远程任务执行；提供者可选择在本地或自有云主机运行自管模型代理，MoyuBot、普通聊天客户端与 SDK 均可接入。先验证 Key 保管与可信计量，完成中心化账本，再评估链上结算。自管代理上报不直接视为已核验用量。本节为规划，功能尚未实现；原有云电脑功能与该市场独立。

## 默认边界

- 个人模式下 API 直连用户自己的 Key；规划中的额度共享模式优先验证提供者自管模型代理，平台托管须明确启用，详见市场开发文档
- 不在本地静默执行命令：所有命令都在云主机上跑，本地只做编排
- 不做「免费额度」暗示，云主机费用由用户自己的 InstaBox 账户承担
