# 第三方素材引用

MeshBot 的 Bot 头像使用了社区复刻项目的角色几何数据。本文记录来源、使用方式与授权状态。

## 来源

| 项目 | 内容 |
| --- | --- |
| 仓库 | [blessonism/grok-icon-study](https://github.com/blessonism/grok-icon-study) |
| 性质 | 对 Grok Bot.app v0.18.0 登录页角色动效的学习复刻（非官方） |
| 采用的文件 | `replica/geometry-data.js` 中的 `window.GROK_GEO` |
| 采用的数据 | `viewBox`、身体轮廓 `blobPath`、idle 眼睛多边形 `eyes[0]` |
| 角色设计归属 | xAI |

上游 README 原文声明：

> 素材归 xAI / 相应权利人所有。
> 本仓库仅供学习参考，请勿商用或再分发。
> 请勿将本仓库内容当作自己的商标或原创素材发布。

## 本仓库的使用方式

不整包复制上游文件，而是用 `scripts/build-avatar-geometry.mjs` 把头像需要的少量数据提炼成一个 2.1 KB 的衍生 JSON：

```
apps/desktop/src/assets/grok/avatar-geometry.json   身体轮廓 + idle 眼睛（JSON 内写明 source / note）
apps/desktop/src/assets/grok/geometry.ts            类型化入口，注释说明如何一行关掉素材
apps/desktop/src/components/BotAvatar.tsx           渲染：团子轮廓填 Bot 自己的渐变色，按 handle 哈希选一张脸
```

上游的 25 组眼睛里有 24 组是为旋转过的身形准备的，放到正立的团子上会越出轮廓，所以只取官方静态图 `grok-blob-idle.svg` 使用的那一组（`eyes[0]`）。Bot 之间的「神情」差异由渲染层对同一组眼睛做刚体变换得到，定义在 [BotAvatar.tsx](../apps/desktop/src/components/BotAvatar.tsx) 的 `POSES` 常量里（空闲 / 好奇 / 专注 / 歪头 / 瞇眼 / 张望），按 `handle` 哈希取用，所以同一个 Bot 每次启动都是同一张脸。

填充色、圆角、描边这些视觉参数全部来自 MeshBot 自己的 Bot 配色系统，所以这套几何只是「形状模板」，不替代上游的动画引擎（弹簧、状态机、视线跟随都没有引入）。

## 授权状态：请注意

**上游仓库没有 LICENSE 文件**，按著作权默认规则属于「保留所有权利」，并且它明确要求不要再分发。MeshBot 是 MIT 开源项目，把衍生几何随源码分发，与上游的要求存在冲突。

本项目采取的缓解措施：

1. 只提炼必需的轮廓数据，不复制上游代码、PNG、图标；
2. 在 `avatar-geometry.json`、本文件、`README.md` 三处标注来源与权利人；
3. 素材与代码解耦，移除它只需要一处改动（见下）。

但这些都只是标注，**不等于取得了许可**。如果你要把 MeshBot 正式发布或商用，建议二选一：

- **不用这套几何**：把 `apps/desktop/src/assets/grok/geometry.ts` 的 `GROK_AVATAR` 改成 `null`，界面自动回落到「渐变底 + 首字母」头像，其它代码不用动；也可以直接删掉 `avatar-geometry.json` 与本目录，改为自绘角色。
- **保持仓库干净**：把 `avatar-geometry.json` 从版本控制里排除，只保留生成脚本，由使用者自行下载上游数据后本地生成。

## 重新生成

```bash
# 1) 自行获取上游 replica/geometry-data.js
#    默认放到 .work/grok-src/geometry-data.js（该目录已被 .gitignore 排除）
#    也可以放到别处，用 GROK_GEO=<路径> 指定
# 2) 生成衍生 JSON
node scripts/build-avatar-geometry.mjs
```

上游 25 组眼睛里有 24 组是为旋转过的身形准备的，直接放到正立的团子上会越出轮廓，所以只取官方静态图 `grok-blob-idle.svg` 使用的那一组（`eyes[0]`）。Bot 之间的「神情」差异由渲染层对同一组眼睛做刚体变换得到，定义在 [BotAvatar.tsx](../apps/desktop/src/components/BotAvatar.tsx) 的 `POSES` 常量里（空闲 / 好奇 / 专注 / 歪头 / 瞇眼 / 张望），按 `handle` 哈希取用，所以同一个 Bot 每次启动都是同一张脸。

## 其它素材

- 界面图标：全部为 `apps/desktop/src/components/Icon.tsx` 中的自绘内联 SVG。
- 字体：使用系统字体栈，未附带任何字体文件。
- 未使用第三方图片、音效、插画。
