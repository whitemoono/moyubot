# MoyuBot 表情片（竖版 / 横版）

80 秒，30 fps。同一套画面与音频出两种画幅：9:16 1080 × 1920 竖版，16:9 1920 × 1080 横版。七个角色，每个八种表情，原创音乐与音效。

- `output/MoyuBot-Expressions-Vertical.mp4`：可直接播放的竖屏成片。
- `output/MoyuBot-Expressions-Landscape.mp4`：可直接播放的横屏成片。
- `output/poster.jpg`：竖屏封面。
- `output/poster-landscape.jpg`：横屏封面。
- `output/storyboard.jpg`：七个角色逐镜预览。
- `output/expression-sheet.jpg`：八种表情对照图。
- `output/music.wav`、`output/effects.wav`、`output/master.wav`：声音分轨与母带。
- `STORYBOARD.md`：角色顺序、分镜、表情设计、声音与出处。

两个预览页共用同一份音频与素材：竖版 `/media/moyubot-expressions/`，横版 `/media/moyubot-expressions/index-landscape.html`。

沿用原视频工程的本地服务器：在仓库根目录运行 `node media/moyubot-film/serve.cjs`，再打开上面的地址。已运行该服务器时可直接切换地址。预览支持播放、暂停、进度拖动、静音，以及空格和左右键。

本工程需要 Chrome、Playwright、Python（numpy、Pillow、imageio-ffmpeg）。`render.cjs` 依次尝试 `playwright`、`playwright-core`，也接受 `NODE_PATH` 指向本地安装。外部环境可自行安装相同依赖，`MOYU_FFMPEG` 可指定 FFmpeg 路径。

```powershell
python media/moyubot-expressions/audio.py
node media/moyubot-expressions/render.cjs --qa
python media/moyubot-expressions/contact-sheet.py
node media/moyubot-expressions/render.cjs
# 横版：同一套音频，QA 帧写进 output/frames-landscape/
node media/moyubot-expressions/render.cjs --landscape --qa
node media/moyubot-expressions/render.cjs --landscape
```

具体表情与画面在 `film.js`（竖版）与 `film-landscape.js`（横版），声音在 `audio.py`。角色几何、彩色图层、品牌图通过相对路径读取本仓库已有素材，保留目录结构即可。第三方角色权利说明见 `STORYBOARD.md` 和仓库 `docs/ASSETS.md`。所有生成文件在 `output/`，已从 Git 排除。
