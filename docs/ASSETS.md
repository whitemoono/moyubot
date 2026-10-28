# 第三方素材引用

MoyuBot 的 Bot 头像直接使用社区复刻项目的角色引擎（vendored）。本文记录来源、使用方式与授权状态。

## 来源

| 项目 | 内容 |
| --- | --- |
| 仓库 | [blessonism/grok-icon-study](https://github.com/blessonism/grok-icon-study) |
| 性质 | 对 Grok Bot.app v0.18.0 登录页角色动效的学习复刻（非官方） |
| 采用内容 | `replica/geometry-data.js`（25 组眼睛、18 种身形、11 套墨色）+ `replica/src/` 引擎（math / tables / pose / tricks / fx / eyes / character） |
| 放置位置 | `apps/desktop/src/assets/grok/engine/`（原样拷入，未改动） |
| 角色设计归属 | xAI |

上游 README 原文声明：

> 素材归 xAI / 相应权利人所有。
> 本仓库仅供学习参考，请勿商用或再分发。
> 请勿将本仓库内容当作自己的商标或原创素材发布。

## 本仓库的使用方式

- `apps/desktop/src/assets/grok/grok-engine.ts` 按上游 `index.html` 的顺序加载 8 个 IIFE 脚本，暴露有类型的 `createGrokCharacter(svg, opts)` 入口。
- `apps/desktop/src/components/BotAvatar.tsx` 把每个 Bot 头像挂成一个引擎实例：
  - **身形**按 `handle` 哈希从 blob / teardrop / cloud / capsule / shield / gem / pebble / hex 中挑选，同一 Bot 固定；
  - **表情**由运行时状态驱动（状态名来自上游 `tables.js` 的播放表）：审批请求 → `listening`；Agent 事件流 → `thinking` / `working` / `searching` / `writing` / `loading` / `dictating` / `happy` / `alerting`；云电脑状态 → `sleeping` / `waking` / `working` / `alerting`；空闲时走登录页同款 `onboarding` 轮换（idle ↔ curious ↔ happy …）；
  - 墨色与眼白用 CSS 变量 `--avatar-ink` / `--avatar-void` 跟随 MoyuBot 的黑白主题，不引入彩色。
- 弹簧、眨眼、wink、视线游走、旋转特技、overlay（铅笔 / 铃铛 / 思考点）全部沿用上游实现，MoyuBot 没有重写任何动画逻辑。

## 授权状态：请注意

**上游仓库没有 LICENSE 文件**，按著作权默认规则属于「保留所有权利」，并且它明确要求不要再分发。MoyuBot 是 MIT 开源项目，把整套引擎随源码分发，与上游的要求存在冲突，且引擎本身是对 xAI 商业产品的学习复刻。

本项目采取的缓解措施：

1. 引擎文件原样保留在上游作者与本文件的出处标注下（各文件头部注释未删改）；
2. 在 `README.md`、本文件、`grok-engine.ts` 三处标注来源与权利人；
3. 素材与代码解耦，移除它只需要一处改动（见下）。

但这些都只是标注，**不等于取得了许可**。如果你要把 MoyuBot 正式发布或商用，二选一：

- **不用这套引擎**：把 `apps/desktop/src/assets/grok/grok-engine.ts` 的 `GROK_ENGINE_ENABLED` 改成 `false`，头像自动回落到「单色底 + 首字母」，其它代码不用动；也可以直接删掉 `engine/` 目录。
- **保持仓库干净**：把 `engine/` 目录排除出版本控制，由使用者自行下载上游仓库后本地补齐。

## 更新引擎

直接从上游仓库重新拷贝 `replica/geometry-data.js` 与 `replica/src/*.js` 到 `engine/` 即可，加载顺序见 `grok-engine.ts`。没有生成脚本，也没有中间格式。

## 其它素材

- 界面图标：全部为 `apps/desktop/src/components/Icon.tsx` 中的自绘内联 SVG。
- 字体：使用系统字体栈，未附带任何字体文件。
- 未使用第三方图片、音效、插画。
