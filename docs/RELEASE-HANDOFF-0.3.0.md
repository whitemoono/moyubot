# v0.3.0 发布交接说明

本会话已完成全部**构建、打包、提交、tag**工作。只差把产物推到 GitHub 并创建 Release（需要你的 GitHub 凭据）。按下面步骤执行即可。

## 已就绪的产物

| 文件 | 大小 | SHA-256 |
| --- | --- | --- |
| `apps/desktop/release/MoyuBot.Setup.0.3.0.exe` | 132.9 MB | `35e60bc6271e264ca52d0a539cc56fa6b8ea0fdd3c1f1abbbbdb04dca91010ad` |
| `apps/desktop/release/MoyuBot.Setup.0.3.0.exe.blockmap` | 0.1 MB | `e5839cd028b5108fd370609c8ea283fbdebba3de8abce8537d43a1b58f1f96c1` |

发布脚本会自动生成并上传 `SHA256SUMS.txt`。

## 代码状态（已提交 + 已打 tag）

```
master HEAD:  7e80504 release: 0.3.0 - bot template market ...
tag v0.3.0:   指向 7e80504（本地已重指向新 commit）
```

工作区干净，无未提交改动。

## ⚠️ 先处理远端的孤儿 tag

GitHub 远端已有一个 **v0.3.0 孤儿 tag**：指向错误的旧 commit（`6b8599d`，实为 0.2.7 历史），且没有对应 release。**发布前必须先删掉它**，否则脚本创建 release 会挂到错误 commit。需要一行：

```
git push origin --delete v0.3.0
```

## push master + 新 tag

```
git push origin master
git push origin v0.3.0
```

> 说明：远端 master 停在 `36be865`（stay on 0.2.9），本地上传 `7e80504` 是其后继 commit，是**普通快进**，不需要 force。若远端被其它人推进过导致非快进，再考虑 `--force`（先确认无他人提交）。

## 创建 Release + 上传产物

```
pnpm release:github --notes=docs/release-0.3.0.md
```

- 需要环境变量 `GH_TOKEN=<你的token>`，或已在本机 `git auth`（脚本会走 `git credential fill`）
- 脚本逻辑：
  - 读 `apps/desktop/package.json` 版本 → `v0.3.0`
  - 用 `docs/release-0.3.0.md` 作为发布说明（`--notes=` 指定）
  - 创建/更新 release → 上传 `SHA256SUMS.txt`、`MoyuBot.Setup.0.3.0.exe`、`.blockmap`
  - 校验更新器所需的资产名（`apps/desktop/electron/updates.ts` 要求的格式）

## 发布说明（已写在 docs/release-0.3.0.md）

核心：**Bot 模板市场** —— 内置通用研发助手 6 个 + 远程 moyubot 专用 6 个；客户端「设置 → Bot 市场」打开即见、支持本地/云工作区导入；官网市场页 `https://moyubot.net/market.html`。

## 验证发布结果

发布后检查：
- `https://github.com/whitemoono/moyubot/releases/tag/v0.3.0` 存在且非 draft
- 资产齐全：exe + blockmap + `SHA256SUMS.txt`
- 版本号与更新器匹配：tag `v0.3.0`、资产名 `MoyuBot.Setup.0.3.0.exe`

## 产物验证记录（构建时已做）

安装包 `MoyuBot.Setup.0.3.0.exe` 已确认：
- asar 内含主进程入口 `dist-electron/main.js`、`app.js`、`preload.js` ✅
- asar 内含 Bot 市场核心 `@moyu/core/dist/bot-templates.js`、`presets.js` ✅
- 打包结构为标准 electron-builder 布局，与已发布的 v0.2.9 一致 ✅
- 渲染 bundle（`dist/assets/index-*.js`）含市场代码 ✅

> **能启动验证说明**：在本会话受限 shell 里，打包后的 GUI exe 会启动后正常退出（exit 0、无报错）——这是 `apps/desktop/scripts/dev.mjs` 注释指出的 Windows 现象（GUI-subsystem 程序从自动化控制台 spawn 常 exit 0），属沙箱限制而非产物问题。产物结构/入口/内置代码均已核对完整，发布后请在真实 Windows 桌面首次运行确认窗口正常。