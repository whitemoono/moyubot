# MoyuBot v0.1.4 · 111 秒横屏产品介绍（film v3）

成片：1920 × 1080（16:9），30 fps，111 秒，H.264 + AAC。
中文旁白（edge-tts 神经语音 XiaoxiaoNeural）、烧录字幕 + 独立 SRT、原创程序化配乐（108 BPM，C 大调 / A 小调）、14 种合成音效。
本片全部界面、鼠标、输入与状态变化均由代码绘制（React + CSS/SVG + WebGL shader），命令与结果为解释产品工作流的示例；演示数据均标注。七个头像由应用内 vendored 的角色引擎（driven 模式）逐帧确定性渲染，表情随状态变化。

技术栈：Remotion 4（React 19）；头像引擎 `src/vendor/grok/`（与应用内 `BotAvatar` 同源）；极光背景为自定义 GLSL 片元着色器（`src/components/Aurora.tsx`）；音频由 `scripts/gen-audio.py` 生成（numpy + scipy 合成，无采样素材）。

| 时间 | 场景 | 画面与动作 | 旁白重点 | 音乐与音效 |
| --- | --- | --- | --- | --- |
| 00–07.5 | 钩子 | WebGL 极光夜色；「23:47 方案改到第三版」→ 换 AI 来。；七个团子从底部弹入 | 深夜加班的痛 → 换 AI 来 | 氛围垫 + 五音动机；七连 pop 入场 |
| 07.5–15.5 | 品牌 | Logo 弹入、MoyuBot + v0.1.4、品牌句、四枚标签；头像列队轻浮动 | 开源桌面 Agent 工作空间；多 Bot 一台按需唤醒的云电脑 | chime 落版；轻 pop |
| 15.5–28.5 | 工作空间 | 仿真桌面端：Bot 列表（7 头像）+ 对话 + 右侧工作区面板；22s 处切换「本地 Windows → InstaBox 云电脑」，路径从 `D:\Workspace\大肥鱼\` 变为 `/data/home/moyubot/大肥鱼/` | 固定对话与独立工作目录；双工作区随时切换 | 轻鼓组进入；click / ping / key |
| 28.5–43.5 | Agent 循环 | 用户输入 → 头像思考 → 四张工具卡逐个执行（命令 / 读写 / 搜索 / 出图）→ 完成卡；36.9s 玻璃审批弹层（允许 / 仅此一次 / 拒绝）；模式胶囊高亮「每步审批」；41s 上下文压缩 87% → 41% | 25 个内置工具；自动执行或每步审批；计划模式；自动压缩 | 节拍稳定；click 流水 + chime 完成 + notify |
| 43.5–57.5 | 共享云电脑 | 深色科技页：云主机卡「挂起中 🌙」→ power_up 唤醒 → 运行中（环形进度）→ 终端流式执行 cloud_exec/backup → 53.2s 自动休眠；触发器芯片 cloud_exec / read / write / 桌面操作 | 纯聊天不打扰、一碰命令才唤醒；双重兜底不烧配额 | 贝斯加厚；power_up / power_down 扫频 |
| 57.5–77.5 | 七个 Bot 角色 | 角色巡游：每角色 1.85s 大卡（440px 引擎头像 + 名字 + 专属口头禅 + 主题色），底色随角色渐变；74s 起七人全家福一行 + 状态演示（思考 → 搜索 → 干活 → 等审批 → 完成） | 七套角色各有性格；表情跟着状态流动 | 半拍音乐盒独奏（角色主题）；每卡 pop、全家福 sparkle |
| 77.5–89.5 | 群聊 + 子代理 | 群「摸鱼突击队」：用户提问 → 三 Bot 顺序接力（各挂自己的模型）；右侧 run_script 面板：4 个只读子代理并行进度条 → 汇总完成 | 2–12 成员接力、各自权限；子代理并行调研、脚本编排 | 鼓组推进；bubble ×3、swoosh 派发、ping ×4 |
| 89.5–100 | 记忆 / 节奏 / 用量 | 三栏卡：长期记忆（📌 固定 + 普通）、定时任务（聊天改 cron + 开关）、Token 用量（柱状图 + Bot 排行） | 记忆隔离去重；一句话安排定时任务；用量一目了然 | 回归轻快；page / notify / ping2 |
| 100–111 | 收尾 | 回到极光夜色：Logo + 品牌句 + 七头像挥手；四张链接卡（官网 / GitHub / Telegram / QQ 群）；106s「摸鱼愉快」红章盖下 | MIT 开源即下即用；邀请共创与反馈 | 动机再现；chime + 七连 pop + sparkle；渐弱 |

## 固定信息

- 品牌句：让 AI 上班，你负责摸鱼。
- 官网：https://moyubot.net · GitHub：https://github.com/whitemoono/moyubot
- Telegram：https://t.me/moyubotnya · QQ 群：2162036353
- 角色顺序（shape）：大肥鱼 chibi · 千金 nemu · 小龙娘 shiro · 大小姐 mikan · 小猫娘 neko · 雌小鬼 tsuki · 夜猫 zeta
- 演示标注：功能页左下角「操作流程演示 · 代码动画（示例数据）」；收尾页注明示例说明。

## 音乐结构（原创程序化，108 BPM）

| 段落 | 时间 | 和声 | 配器 |
| --- | --- | --- | --- |
| intro | 0–15.5 | Am F C G | 氛围垫 + 五音动机（音乐盒） |
| grooveA | 15.5–43.5 | Am F C G ×3 | 轻鼓组 + 拨弦琶音 + 半音符贝斯 |
| grooveB | 43.5–57.5 | F G Am Em | 八分贝斯 + blip 打点 |
| musicbox | 57.5–77.5 | C G Am F … | 八音盒旋律 + 半拍底鼓 + 沙锤 |
| build | 77.5–89.5 | F G Am G | 四踩渐强 + clap + riser |
| grooveA2 | 89.5–100 | F C G Am | 回归轻快 |
| outro | 100–111 | Am F C G | 动机再现 + 垫，2.2s 渐弱 |

音效库（全部合成）：swoosh / pop / boop / ping / ping2 / chime / sparkle / click / key / notify / bubble / page / power_up / power_down。

## 工程结构

```
media/moyubot-film-v3/
  story.json              唯一事实源：场景 / 旁白 / 音效事件 / 配乐段落 / 角色卡
  scripts/gen-audio.py    旁白（edge-tts，SAPI 兜底）+ 配乐 + 音效 + SRT + 时长校验
  src/
    Root.tsx              主合成 + 每场景独立可预览的子合成
    MoyuBotIntro.tsx      时间线装配
    Mixdown.tsx           配乐闪避 + 旁白对位 + 音效对位
    components/GrokAvatar.tsx   真实头像引擎（driven 模式逐帧重放，固定种子随机数）
    components/Aurora.tsx       GLSL 极光背景
    components/StaticAvatar.tsx 引擎官方矢量路径的静态头像
    components/ui.tsx     字幕 / 窗体 / 标签等 UI 套件
    scenes/*.tsx          九个场景
    vendor/grok/          vendored 角色引擎（版权与关停说明见 docs/ASSETS.md）
  output/                 成片、SRT、QA 帧与音频中间产物
```

## 复现

```bash
cd media/moyubot-film-v3
pnpm install
python scripts/gen-audio.py     # 生成 public/{audio,voice}
pnpm run render                 # npx remotion render MoyuBotIntro output/MoyuBot-Introduction-v3-1080p.mp4
```

功能准确性以仓库 README 与 docs/（BOT-ACTIVITY、LONG-TERM-MEMORY、WORKSPACES-AND-SYNC 等）为准；片中工具执行、群聊发言、用量图表均为演示数据。头像角色素材来自社区复刻项目 grok-icon-study（版权与限制见 docs/ASSETS.md），本片仅用于展示 MoyuBot 的实际使用外观。
