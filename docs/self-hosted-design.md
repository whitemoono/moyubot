# 自托管多端方案设计（moyubot self-hosted）

> 目标：云电脑不再是唯一（现为 instabox）。支持自部署：
> - 自托管服务器（Linux/Windows，headless，`npm i -g` 安装）
> - 远程电脑 = 自己的 Linux/Windows 桌面/服务器（部署 agent 客户端反向接入）
> - 三段互通：桌面 app ↔ 自托管服务器 ↔ 原生手机 app

## 1. 现状与可复用资产

| 资产 | 位置 | 说明 |
| --- | --- | --- |
| `CloudDriver` 接口 | `packages/core/src/cloud.ts:11` | 已抽象 `kind: 'instabox'\|'mock'`，**加自托管 driver 零上层改动** |
| `InstaBoxClient` | `packages/core/src/instabox.ts:84` | 复刻其 `/exec /files /desktop` 协议可作为协议蓝本 |
| `syncSnapshot/applySyncRecords` | `packages/core/src/store.ts:579/594` | 六类数据（bots/conversations/messages/memories/schedules/profile）的便携同步原语，**手机同步直接复用它** |
| **`SyncEngine`** | `packages/core/src/sync.ts:11` | **已存在完整同步引擎**：`SyncRecord` 带 `revision/baseRevision/opId`、outbox 队列、接受/回执、冲突按 revision 裁决。M1（桌面↔服务器）只需给它接一个 WSS 传输层，**不需要重写合并逻辑** |
| `MobileConnectionDialog` | `apps/desktop/src/components/MobileConnectionDialog.tsx` | 现为 WIP 占位（"待开发"），接入点已预留 |
| 本地工作区 | `workspace_local` | 已有"本机即电脑"概念，可扩展为"远程 agent 电脑" |

## 2. 总体架构（三段互通）

```
┌───────────────┐    wss/sync     ┌───────────────────┐    wss/agent    ┌──────────────────┐
│  桌面 App      │◄──────────────►│  自托管服务器      │◄───────────────►│ 远程电脑 agent   │
│  (electron)    │  数据双向同步   │  (headless core)   │  反向连接        │  (Linux/Win 桌面) │
│  Windows/macOS │                │  npm i -g moyu     │                  │  或服务器        │
└───────────────┘                └────────┬──────────┘                  └──────────────────┘
                                          │ wss/sync + 代理执行
                                          ▼
                                 ┌───────────────────┐
                                 │  原生手机 App      │
                                 │  (RN/Flutter)     │
                                 └───────────────────┘
```

角色：
- **桌面 App**（主实例）：完整 GUI、Bot 编排、设置。数据落在本地 `%APPDATA%/@moyu`。
- **自托管服务器**（副实例）：headless 跑同一套 core，作为**同步枢纽 + 远程电脑代理**。无 GUI。
- **远程电脑 agent**：装在被托管的机器上（Linux 桌面 / Windows 桌面 / 服务器），提供该机的 shell 执行、文件读写、桌面流。
- **手机 App**：连服务器，看/发消息、看电脑状态、触发执行（agent 远程电脑）。

## 3. 自托管服务器（`moyu-server`）

### 3.1 包形态
- 新增 npm 包：`packages/server`（或复用 `packages/core` + 新入口）。
- `npm i -g @moyu/server` → 命令 `moyu-server`（Linux/Windows 均可）。
- 无 electron 依赖，纯 Node；数据目录 `~/.moyu-server`（可用 `MOYU_DATA_DIR` 覆盖）。
- 首次启动生成 token（`moyu-server init` 或首次运行打印），供各端配对。

### 3.2 职责
1. **同步枢纽**：接受桌面/手机连入，`wss` 通道跑 syncSnapshot/applySyncRecords 双向增量。
2. **远程电脑注册中心**：记录哪些 agent 已连入（机器名、OS、能力：shell/文件/桌面）。
3. **执行代理**：手机/桌面发起的 `cloud_exec/read/write/desktop_action` 请求，路由到对应 agent 执行并回传。
4. **能力盘点**：agent 连入时上报其 Claude 配置/技能（复刻 `inventoryCloud()` 探针，改为 agent 自报）。

### 3.3 传输
- 单条 **WSS**（WebSocket over TLS）连接承载三类帧：
  - `sync` 帧：`{type:'sync', records: SyncRecord[]}`（双向）
  - `exec` 帧：`{type:'exec', id, machine, cmd, timeout}` → `{type:'exec_result', id, stdout, stderr, exitCode}`
  - `file` 帧：读写请求/响应
  - `desktop` 帧：桌面流（截图/输入事件，VNC-like，起步可先做静态截图轮询）
- 复用 `syncSnapshot()` 作为"对端期望的合并源"，`applySyncRecords()` 落库。

## 4. 远程电脑 agent（`moyu-agent`）

### 4.1 包形态
- `npm i -g @moyu/agent` → 命令 `moyu-agent connect --server wss://... --token ...`
- 运行在目标机上：**Linux 桌面 / Windows 桌面 / 纯服务器**，三平台同一包（Node 即可）。
- 可选注册为系统服务（systemd / Windows 服务 / launchd）。

### 4.2 能力
| 能力 | 实现 |
| --- | --- |
| Shell 执行 | 本地 `spawn`（Linux: bash/sh；Windows: PowerShell），支持 timeout、流式输出 |
| 文件读写 | 本地 fs，路径映射到 agent 可见目录（防逃逸：限定 workspace 目录） |
| 桌面操作 | Linux: X11/Wayland（截图 + xdotool 输入）；Windows: PowerShell + 原生 API 截图/键鼠 |
| 能力盘点 | 自报本机 `~/.claude.json`、skills 目录、`*-mcp` 二进制（对应 inventoryCloud 探针） |
| 反向连接 | 主动连服务器 WSS，带 token 认证；断线重连 + 心跳 |

### 4.3 安全
- 每个 agent 独立 token，服务器校验；agent 侧限定 `allowDirectories`（仿 Claude 的目录许可）。
- 执行默认拒绝危险命令？→ 与现有 `approvalPolicy` 联动：需要审批的命令仍走"桌面端/手机端确认"。

## 5. 自托管"云电脑"驱动（核心改动）

在 `CloudDriver` 旁新增：
```ts
export class RemoteAgentDriver implements CloudDriver {
  kind: 'remote-agent' as const;
  // exec/readFile/writeFile/desktopStart/desktopStream → 通过 wss 路由到 agent
  // listMachines/getMachine → 服务器上已注册的 agent 列表
  // createMachine/act/waitForState → 服务器管理的 agent 实例状态
}
```
- 服务器 = 一台"远程电脑"时，`RemoteAgentDriver` 指向**服务器本机 agent**（local loopback），手机可直连执行。
- 多 agent 时按 machineId 路由。
- 接入点：`CloudHostSettings.kind` 增加 `'remote-agent'`，设置 UI 加"自托管服务器"配置项（服务器地址 + token）。

## 6. 手机端（原生 App）

- 选型：**React Native**（与 web/electron 共享 TS 类型、core 的同步原语语义；如偏重桌面流体验可用 Flutter，但 RN 与现有栈更近）。
- 包：`apps/mobile`（monorepo 内新 workspace）。
- 功能（MVP）：
  1. 连接服务器（地址 + token）
  2. 聊天：看会话、发消息（复用 core 消息类型）
  3. 电脑状态 + 远程执行（agent 已连接的机器，命令/文件）
  4. 能力清单查看（服务器盘点结果）
- 数据流：手机本地也建一个精简 Store（`packages/core` 纯 Node 部分可直接 import），wss 同步。
- 不做（v1）：手机本地跑 Bot/定时任务（执行归属服务器/桌面端，与现 schedule 语义一致：mobile 只读状态）。

## 7. 数据互通模型（三段）

```
桌面 Store ──sync──► 服务器 Store ──sync──► 手机 Store
     ▲                    ▲                    │
     └──── 执行结果/状态 ◄─┘◄──── 远程 agent ◄──┘
```
- **同步方向**：双向。任一端的修改（新会话、新消息、记忆、计划）经 `syncSnapshot/applySyncRecords` 扩散到另两端。
- **冲突**：沿用现有同步语义（便携数据、无执行副作用；`applySyncRecords` 的合并规则已存在）。
- **执行归属**：始终由"有 agent/云电脑的一端"执行（桌面本地、服务器代理远程 agent、instabox 云），结果作为消息回灌同步。
- **身份**：三端同一 `userId`（首次配对时服务器签发），保证 memories/计划归属一致。

## 8. 实施拆分（里程碑）

### 8.1 GitHub Codespaces 驱动（第三个 CloudDriver 实现）

```
登录（Device Flow，scopes: codespace + repo + admin:public_key）
  → ensureWorkspaceRepo：自动创建/复用私有仓库 moyubot-workspace（auto_init，无需用户手动建）
  → createCodespace：从该仓库创建 2 核 8GB Codespace（basicLinux32gb）
  → SSH 密钥注册（生成 ed25519 → POST /user/keys）→ exec / 文件走 SSH（ssh2）
  → 桌面：SSH 安装 XFCE + VNC + noVNC（容器内 6080），Codespaces 端口转发自带 GitHub 登录鉴权
  → 驱动接管：lifecycle（REST）+ exec/files（SSH）+ desktop（noVNC URL 嵌入 UI）
```

- 设置页入口：云电脑 → GitHub Codespaces 卡片（① 登录 + 额度卡已上线；token 在加密密钥库）
- 额度：`GET /user/codespaces/quota`，免费 120 core-小时/月（2 核 60 小时）+ 15GB 存储，卡片实时展示
- 睡眠映射：Codespaces idle_timeout（默认 30 分钟，上限 4 小时）；停止后重启 10–30 秒
- 限制：exec 走 SSH 通道（无官方 REST exec），需自行管理连接复用与断线重连

| 里程碑 | 内容 | 依赖 |
| --- | --- | --- |
| M1 | `packages/server`：headless core + **复用现成 SyncEngine** 接 WSS 传输（桌面↔服务器互通） | SyncEngine 已存在，只差传输层，工程量最小 |
| M2 | `packages/agent`（Linux 先行）：反向连接 + shell/文件 + 注册上报 | M1 的 wss 复用 |
| M3 | `RemoteAgentDriver`：桌面把远程 agent 当"云电脑"用（exec/文件/盘点） | M2 |
| M4 | Windows agent（PowerShell 执行 + 桌面流） | M3 |
| M5 | `apps/mobile` RN：连服务器 + 聊天 + 状态 + 远程执行 | M1 |
| M6 | 桌面流增强（远程桌面视图）、手机端桌面操作 | M4/M5 |

## 9. 与现有代码的对接点清单

- `packages/core/src/cloud.ts`：`CloudDriver` 加 `remote-agent` 分支 + `RemoteAgentDriver`
- `packages/core/src/types.ts`：`CloudHostSettings` 扩展 `kind`、`serverUrl`、`token`
- `packages/core/src/capabilities.ts`：`inventoryCloud()` 支持 agent 自报（替代/补充探针）
- `apps/desktop/src/components/MobileConnectionDialog.tsx`：占位 → 填服务器地址/token/二维码配对
- `apps/desktop` 设置 UI：云电脑页加"自托管服务器"卡片（连接状态、已注册 agent 列表）
- `packages/core/src/store.ts`：`syncSnapshot/applySyncRecords` 已是现成同步原语，直接复用；需确认多端 revision 合并（若现无版本号需补 `revision` 递增）

## 10. 风险与取舍

- **桌面流**（远程 GUI 显示）是最大工程量；MVP 先做"截图轮询 + 命令执行"，实时桌面流后置。
- **手机端原生 app** 是新工程；若想更快落地，可先用 PWA 版验证协议，原生 app 并行开发。
- **agent 安全边界**：目录限定 + token 认证是底线，需与 approvalPolicy 联动。
- **同步冲突**：多端同时编辑同一会话的合并规则需要测试覆盖（现 `applySyncRecords` 已有基础）。
