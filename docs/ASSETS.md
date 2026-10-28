# 第三方素材引用

MoyuBot 的 Bot 头像直接使用社区复刻项目的角色引擎（vendored）。本文记录来源、使用方式与授权状态。

## 来源

| 项目 | 内容 |
| --- | --- |
| 仓库 | [blessonism/grok-icon-study](https://github.com/blessonism/grok-icon-study) |
| 性质 | 对 Grok Bot.app v0.18.0 登录页角色动效的学习复刻（非官方） |
| 采用内容 | 原有 `geometry-data.js`，以及用户提供的 `ai girl bot/replica/` 中的引擎与 7 套角色头像 |
| 放置位置 | `apps/desktop/src/assets/grok/engine/`；角色文件和引擎保留原文 |
| 角色设计归属 | xAI |

上游 README 原文声明：

> 素材归 xAI / 相应权利人所有。
> 本仓库仅供学习参考，请勿商用或再分发。
> 请勿将本仓库内容当作自己的商标或原创素材发布。

## 本仓库的使用方式

当前角色文件来自用户指定的本地项目 `ai girl bot`：`chibi`（DeepSeek，默认）、`shiro`（ChatGPT）、`mikan`（Claude）、`neko`（Gemini）、`tsuki`（Grok）、`nemu`（Qwen）、`zeta`（GLM）。该本地项目的 MIT 许可证原文保留为 `engine/LICENSE.ai-girl-bot`；它的 README 对原始造型权利的说明仍适用。主项目不依赖该源文件夹的运行服务或绝对路径。

- `apps/desktop/src/assets/grok/grok-engine.ts` 依次加载几何、7 套角色和引擎脚本，暴露有类型的 `createGrokCharacter(svg, opts)` 入口。
- `apps/desktop/src/components/BotAvatar.tsx` 为实时头像创建引擎实例，历史消息和减少动效模式使用轻量静态 SVG：
  - **身形**保存为 `bot.avatar.shape`；创建与编辑时均可选择，旧数据和未知值默认使用 DeepSeek；
  - **表情**优先由各个 Bot 的实际活动驱动；待命时随机展示歪头、微笑、俏皮、小跳等表情，鼠标移入时回应。思考、搜索、回复、工具执行、等待确认、整理记忆、完成、出错和停止各有对应动作，具体规则见 [BOT-ACTIVITY.md](BOT-ACTIVITY.md)；
  - 角色保留原始彩色图层，主题色保存在 `bot.avatar.from/to` 中；选择器缩略图减少动效，大头像仍响应 Bot 运行状态。
- 弹簧、眨眼、wink、视线游走沿用上游实现；产品头像关闭自动翻转与整体符号变形，保留用户选择的角色造型，并补充书写、加载和提醒的轻量姿态。上游 overlay 仍保留在引擎中。

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

- App 图标：以 `moyubot-landing/site/logo.webp` 的高清透明图为源，由 `scripts/build-icons.py` 导出桌面 512px PNG、界面 256px PNG 和 Windows 多尺寸 ICO。导出时清理边缘的白色底色并使用预乘透明度缩放，保留画面内部的白色细节。需要重新导出时，在已安装 Pillow 的 Python 环境中运行 `python scripts/build-icons.py`。安装包同时携带图标资源，界面直接使用图片本身的圆角与透明边界。

- 界面图标：全部为 `apps/desktop/src/components/Icon.tsx` 中的自绘内联 SVG。
- 字体：使用系统字体栈，未附带任何字体文件。
- 未使用第三方图片、音效、插画。
