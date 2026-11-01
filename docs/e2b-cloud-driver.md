# E2B 云电脑接入说明

> 云电脑驱动现支持三种：`instabox`（保留）、`e2b`（新增）、`mock`（演示）。
> 上层 Bot/工作区/工具代码零改动——`CloudDriver` 抽象已覆盖执行、文件、生命周期、桌面。

## 一句话结论

- **e2b 官方云**：不用自己的服务器，注册拿 API Key 即用；自带 `base` / `code-interpreter-v1` / `desktop` 模板，**desktop 模板开箱即用，无需 build**。
- **e2b 自建**：用同一套代码，把 `apiUrl` / `domain` 指向你的服务器即可。
- 桌面（看画面 + 鼠标键盘 + 截图）：官方 `desktop` 模板直接提供 noVNC 实时流 + 截图 API，已对接项目的 `desktopAction` / `desktopStream`。

## 代码结构

| 文件 | 内容 |
| --- | --- |
| `packages/core/src/e2b.ts` | `E2BClient` / `E2BError`，封装 e2b SDK（官方云与自建共用） |
| `packages/core/src/cloud.ts` | `E2BDriver implements CloudDriver`；`CloudHost.driver` 按 `settings.driver` 分发 |
| `packages/core/src/types.ts` | `CloudHostSettings.driver` 增加 `'e2b'`，新增 `e2bDomain` / `e2bTemplate` |

依赖：`e2b@2.62.0`、`@e2b/desktop@2.5.0`（已加入 `packages/core/package.json`）。

## 设置项（CloudHostSettings）

```ts
{
  driver: 'e2b',
  baseUrl: '',            // 官方云留空；自建填 API 地址，如 https://api.yourdomain.com
  e2bDomain: '',          // 官方云留空；自建填沙箱域，如 yourdomain.com
  e2bTemplate: 'desktop', // 'base' | 'code-interpreter-v1' | 'desktop' | 自建模板名
  machineName: 'moyu-shared',
  remoteWorkspaceDir: '/data/moyubot',   // 云端工作目录
  autoSuspendAfterSeconds: 600,          // e2b 使用本地空闲计时
  idleSuspendMinutes: 10,
  wakeOnDemand: true,
  // …其余字段同 instabox
}
```

## 桌面模板（computer-use）

- 官方 `desktop` 模板 = Ubuntu 22.04 + Xfce + x11vnc + noVNC + Firefox + xdotool/scrot。
- 已实测：`screenshot()` 返回 PNG；`leftClick / doubleClick / rightClick / write / press / scroll / launch / open` 可用；`stream.getUrl()` 返回 `https://6080-<id>.e2b.app/vnc.html?...` 实时桌面。
- 项目侧映射：
  - `driver.desktopStart(id)` → 拉起 noVNC，返回 `{installed:true, running:true}`
  - `driver.desktopStream(id, viewOnly)` → `{url, expiresAt}`
  - `CloudHost.desktopAction(args)` → e2b 走原生 `@e2b/desktop`（截图/输入），instabox 仍走 xdotool/scrot

## 已验证（官方云，真实 API）

- `base` 模板：创建 → exec → 读写文件 → pause(suspend) → kill 全通。
- `desktop` 模板：创建（自动起 Xfce）→ screenshot（PNG）→ 起 Chrome + click/type（截图变化）→ noVNC URL → revoke → kill 全通。
- 现有 `cloud-lifecycle.test.cjs` / `desktop-control.test.cjs` 14 项测试仍通过（instabox/mock 未受影响）。

## 自建 e2b（用你自己的服务器）

自建 e2b 开源后端需在目标机部署 e2b infra（firecracker + orchestrator + api），硬件建议 ≥ 8C16G。仅需把设置里 `baseUrl` / `e2bDomain` 换成自建地址即可复用本驱动，无需改代码。桌面能力取决于自建是否部署 desktop 模板镜像。

## 安全提醒

- API Key 通过 `CloudHostDeps.apiKey`（字符串或取值函数）注入，不落盘到本文件。
- 桌面 noVNC URL 为短期有效（本项目按 10 分钟窗口返回 `expiresAt`），`desktopRevoke` 会 `stream.stop()`。
