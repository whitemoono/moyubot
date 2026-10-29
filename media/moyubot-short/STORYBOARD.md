# MoyuBot · 30 秒新版竖屏介绍

版本：2026-10-29。30 秒，1080 × 1920，9:16，30 fps。中文女声旁白，内嵌中文字幕，原创 120 BPM 轻电子配乐。

本片重新制作第一支产品介绍，以当前桌面端的本地／云电脑工作区为主线。七个角色的名字、外观、配色沿用已确认的版本。

| 时间 | 画面与运动 | 旁白 | 声音 |
| --- | --- | --- | --- |
| 00–04 | 「让 AI 上班。你负责摸鱼。」大字开场，七角色依次弹入、眨眼、微笑；千金保留睡帽和困倦表情 | 让 AI 上班，你负责摸鱼。 | 七声轻提示音，琶音和贝斯进入 |
| 04–09 | 本地 Windows／云电脑切换，新版实际界面取景；展示各自的 Bot、对话、记忆和任务，云电脑标出休眠状态 | 本地或云电脑，各有自己的 Bot 和工作区。 | 柔和滑动转场，切换提示音 |
| 09–14 | 深蓝底，聊天请求卡片进入；放大新版底部命令面板；依次出现执行命令、读取文件、写入文件 | 接入喜欢的模型，让 AI 执行命令、整理文件。 | 短促确认音，节拍延续，旁白时自动降低配乐 |
| 14–19 | 浅色画面，放大长期记忆和例行任务的实际界面；补充执行前确认、用量可查、群聊协作 | 长期记忆、定时任务，执行前还能由你确认。 | 两次卡片出现提示音 |
| 19–24 | 独立的规划画面：跨设备、手机 PWA、MCP、MoyuChain 四张卡依次进入，每张明确标注待开发 | 跨设备、手机访问与 MCP，正在规划。 | 柔和滑动转场、四次轻提示音 |
| 24–30 | Logo、产品名和七个角色集合；官网与完整 GitHub 地址在入场后持续保留到结束 | MoyuBot，开源的智能体工作空间。官网和 GitHub，等你来。 | 三音品牌提示，配乐与旁白自然收尾 |

## 信息核对

当前功能以这些实现和说明为依据：

- `docs/WORKSPACES-AND-SYNC.md`：本地 Windows／云电脑工作区、执行位置、命令面板、调度限制。
- `apps/desktop/src/components/Sidebar.tsx`、`WorkspaceTerminal.tsx`、`Inspector.tsx`、`apps/desktop/src/App.tsx`：实际新版界面。
- `docs/ROADMAP.md`、`docs/MOYUCHAIN-DEVELOPMENT.md`：规划状态。

命令面板逐条执行命令，完成后显示输出。本片没有宣称提供完整交互式终端。本地 Bot 默认执行前确认，确认行为依具体 Bot 权限设置。定时任务需桌面端运行，本地任务还需本机在线；影片中显示此条件。云电脑空闲可休眠，执行时需唤醒。

画面来自当前构建的真实 UI，使用隔离演示数据；所有命令、模型调用和输出在采集过程中均为模拟，不使用真实对话、密钥或实际执行。工作区切换示意没有更改正在执行的任务所属电脑。

## 角色和素材

| 顺序 | 名字 | 形状 | 主色 |
| --- | --- | --- | --- |
| 1 | 大肥鱼 | chibi | #5890f0 |
| 2 | 千金 | nemu | #a8b8fd |
| 3 | 小龙娘 | shiro | #cdbfef |
| 4 | 大小姐 | mikan | #f7844c |
| 5 | 小猫娘 | neko | #91a7f7 |
| 6 | 雌小鬼 | tsuki | #f6d7b4 |
| 7 | 夜猫 | zeta | #343542 |

角色复用仓库已有 Grok 几何素材；表情和姿态由 Canvas 绘制。Logo 复用仓库品牌图。素材来源和权属说明见 `docs/ASSETS.md`。角色身份与模型供应商无固定绑定。

配音：Microsoft Xiaoxiao Neural。配乐及音效为本工程程序合成，没有采用外部音乐录音。

官网：https://moyubot.net

GitHub：https://github.com/whitemoono/moyubot

## 工程与交付

- `output/MoyuBot-30s-Vertical.mp4`：H.264 / AAC，BT.709，1080 × 1920，30 fps，30 秒，适合手机平台上传。
- `output/poster.png`：竖版封面。
- `output/contact-sheet.jpg`：分镜总览。
- `output/MoyuBot.zh-CN.srt`：独立字幕；成片已烧录中文字幕。
- `output/master.wav`、`narration.wav`、`music.wav`、`effects.wav`：混音与分轨。
- `story.json`：时间轴、口播和文案。
- `scenes.js`：六段动画；`build-project.py` 生成浏览器入口与渲染器。
- `film.js`、`index.html`：可拖动、暂停、静音的实时预览。

重新制作的顺序：构建当前桌面 UI；运行 `node media/moyubot-short/capture.cjs` 获取三倍像素界面；使用带 numpy 的 Python 运行 `build-project.py`、`audio.py`；运行 `node media/moyubot-short/render.cjs --qa` 检查画面，再运行 `node media/moyubot-short/render.cjs` 导出。`contact-sheet.py` 生成封面和分镜图。

渲染依赖 Chrome、Playwright、FFmpeg、numpy、Pillow、edge-tts。沿用前两支影片的本地依赖路径，具体见脚本顶部。可运行 `node media/moyubot-short/preview.cjs` 后打开 http://localhost:4318/media/moyubot-short/ 。旧版介绍和头像表情片均保留。
