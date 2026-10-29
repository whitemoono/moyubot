# MoyuBot · 90 秒竖屏介绍

成片：1080 × 1920，9:16，30 fps，90 秒。独立竖版构图、中文旁白、烧录字幕、SRT、原创程序配乐和操作音效。

预览：http://localhost:4318/media/moyubot-vertical/

## 竖版设计

标题区位于上方，操作区沿纵向展开。七个角色使用四加三两排，保留名字。云电脑接入分三屏展示，设置表单改为单列；终端和文件读回上下排列。桌面段使用局部放大构图。字幕按短句轮换，并参考每句实际旁白时长分配时间。

主要内容位于 x=72–976、y=200–1600，字幕在其下方，底部留出空间。平台按钮位置随客户端而异，播放器与 MP4 中的完整内容均可正常查看。完整 GitHub 地址保持一行，避免路径误读。

功能界面由 Canvas 绘制，持续标注「代码流程演示」，没有使用录屏或调用真实云电脑。头像复用产品矢量路径，Logo 使用现有产品素材。

## 分镜

| 时间 | 画面 | 内容与声音 |
| --- | --- | --- |
| 00–05 | Grok？巨型标题、上线版本；七角色围绕电脑入场 | 开源复刻项目上线，合成器起音 |
| 05–17 | Logo、品牌句、七角色两排；官网和完整仓库固定 | 七个伙伴，把想法变成行动；邀请参与开源 |
| 17–27 | Windows / 云电脑切换；单个 Bot 放大；群聊、记忆、任务、用量依次聚焦 | 工作区各自独立，同区 Bot 共用对应电脑 |
| 27–35 | 对话输入 → 工具调用 → 生成简报 | 模型可选，运行命令与读写文件，完成双音 |
| 35–47 | 创建云电脑 → 复制 API Key → 设置保存和刷新 | 注册需邀请码，密钥始终遮罩 |
| 47–57 | 单列表单：模型供应商、模型、权限、工具、保存 | 供应商单独配置；开关与保存提示 |
| 57–70 | 命令逐条输入与结果；文件读回；桌面预览、等待命令、接管和交还 | 默认只读是用户预览；接管后暂停 Bot 电脑工具 |
| 70–74 | PWA、MCP、MoyuChain 三张纵向卡；更多服务商说明 | 全部标注规划或开发中，更多服务商按需求考虑 |
| 74–84 | 邀请码限制大卡、免费试用、模型与费用三项说明 | 无 InstaBox 账户暂不能使用云电脑；费用试用以官方为准 |
| 84–90 | 七角色、网站、完整仓库、Telegram、QQ、Star 邀请 | 开源共创，邀请反馈；音乐收尾 |

## 固定信息

- 品牌句：让 AI 上班，你负责摸鱼。
- 官网：https://moyubot.net
- 仓库：https://github.com/whitemoono/moyubot
- Telegram：https://t.me/moyubotnya
- QQ 群：2162036353
- 大肥鱼 / 千金 / 小龙娘 / 大小姐 / 小猫娘 / 雌小鬼 / 夜猫，角色人格与模型供应商独立。

## 修改与导出

- `animation.js`：独立竖版构图、打字、鼠标、开关、控制权与短句字幕。
- `story.json`：10 个分镜、11 段旁白与字幕、每段起止时间。
- `audio.py`：复用横版的声音风格，按竖版时间重新编排音效和混音。旁白使用 Xiaoxiao Neural，原创 100 BPM 程序配乐。
- `render.cjs`：逐帧 Canvas → H.264 / AAC MP4，BT.709；`MOYU_FFMPEG` 可指定其他 FFmpeg 路径。
- `qa-player.cjs`：播放、暂停、拖动、键盘、结束重播、静音、声音元数据与布局检查。

在仓库根目录执行：

```powershell
node media/moyubot-vertical/preview.cjs

# 新终端，重新生成音频（神经语音需联网）
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" media/moyubot-vertical/audio.py
node media/moyubot-vertical/render.cjs --qa
node media/moyubot-vertical/qa-player.cjs
node media/moyubot-vertical/render.cjs
```

改配音后删除 `output/voice/voice-XX.mp3` 对应缓存（从 00 开始）。修改文字字幕无需联网。`output/audio-report.json` 记录旁白实测时间与速度，播放器据此分配短句时间。当前本机依赖与横版共用：Chrome、Playwright、Python NumPy、`.work/video-tools` 下的 edge-tts / imageio-ffmpeg。

产品事实参照当前 `docs/WORKSPACES-AND-SYNC.md`、`CloudDesktop.tsx`、`BotsView.tsx`、`packages/core/src/tools.ts`。命令面板逐条执行并在结束后返回结果；不是完整交互终端。MoyuChain 为规划中的模型额度互助市场。云电脑运行、试用规则以 InstaBox 账户及官方说明为准。邀请码限制依据本次发布说明更新。定时任务需应用运行，本地任务还需电脑在线。

原横版、短视频与表情视频文件均保留在原目录。
