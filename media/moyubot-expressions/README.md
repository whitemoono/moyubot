# MoyuBot 竖屏表情片

80 秒，9:16，1080 × 1920，30 fps。七个角色，每个八种表情，原创音乐与音效。

- `output/MoyuBot-Expressions-Vertical.mp4`：可直接播放的竖屏成片。
- `output/poster.jpg`：竖屏封面。
- `output/storyboard.jpg`：七个角色逐镜预览。
- `output/expression-sheet.jpg`：八种表情对照图。
- `output/music.wav`、`output/effects.wav`、`output/master.wav`：声音分轨与母带。
- `STORYBOARD.md`：角色顺序、分镜、表情设计、声音与出处。

沿用原视频工程的本地服务器：在仓库根目录运行 `node media/moyubot-film/serve.cjs`，再打开 `/media/moyubot-expressions/`。已运行该服务器时可直接切换地址。预览支持播放、暂停、进度拖动、静音，以及空格和左右键。

本工程需要 Chrome、Playwright、Python（numpy、Pillow、imageio-ffmpeg）。当前环境复用原视频的 `.work/video-tools` 与 Codex 内置 Playwright。外部环境可自行安装相同依赖，`MOYU_FFMPEG` 可指定 FFmpeg 路径。

```powershell
python media/moyubot-expressions/audio.py
node media/moyubot-expressions/render.cjs --qa
python media/moyubot-expressions/contact-sheet.py
node media/moyubot-expressions/render.cjs
```

具体表情与画面在 `film.js`，声音在 `audio.py`。角色几何、彩色图层、品牌图通过相对路径读取本仓库已有素材，保留目录结构即可。第三方角色权利说明见 `STORYBOARD.md` 和仓库 `docs/ASSETS.md`。所有生成文件在 `output/`，已从 Git 排除。
