# 可编辑的 90 秒横屏视频

预览：<http://localhost:4318/media/moyubot-film-v2/>

成片：`output/MoyuBot-Introduction-90s-1080p.mp4`。

## 修改位置

- `animation.js`：Canvas 布局、颜色、角色、鼠标、打字、按钮与操作状态。所有画面可从任意时间重新计算，支持向前或向后拖动。
- `story.json`：分镜起止时间、配音、字幕、官网及群组信息。`subtitle` 可与口播文字分开。
- `audio.py`：中文神经语音、原创 100 BPM 程序配乐、点击 / 输入 / 完成提示、旁白时音乐压低，48 kHz 双声道。
- `render.cjs`：逐帧导出，H.264 / AAC，BT.709，1080p，30 fps。
- `STORYBOARD.md`：完整分镜与功能边界说明。

除现有 Logo 外，界面与角色均实时绘制；角色直接复用产品 SVG 路径，没有界面截图。无需真实云电脑、模型账户或 API Key。

## 本机制作

从仓库根目录执行。Node 使用本机运行时；渲染脚本优先加载 Playwright，找不到时使用 Codex 捆绑版本。Python 使用本机 Codex 运行时，需 NumPy；音频脚本从 `.work/video-tools` 读取 edge-tts、imageio-ffmpeg。Chrome 已安装。

```powershell
# 已有 4318 预览服务时无需再次启动
node media/moyubot-short/preview.cjs

# 新终端中生成配音、配乐、音效、混音与 SRT（神经配音需联网）
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" media/moyubot-film-v2/audio.py

# 生成关键帧并检查分镜、跳转
node media/moyubot-film-v2/render.cjs --qa

# 检查播放器的声音、播放、拖动、键盘与手机布局
node media/moyubot-film-v2/qa-player.cjs

# 重新导出 90 秒视频
node media/moyubot-film-v2/render.cjs
```

修改旁白后，删除 `output/voice/voice-XX.mp3` 中对应的一条缓存再运行 `audio.py`；编号从 00 开始。`output/audio-report.json` 保存每句时间与速度，避免超出分镜。修改分镜时须同步画面中的动画节点和音效时间。`MOYU_FFMPEG` 环境变量可覆盖默认 FFmpeg 路径。

输出目录还包含 `master.wav`、独立旁白 / 配乐 / 音效、`MoyuBot.zh-CN.srt`、关键帧。原横屏、竖屏与表情视频均保留在原目录。
