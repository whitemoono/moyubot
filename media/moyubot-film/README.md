# MoyuBot 产品视频工程

112 秒 / 1920 × 1080 / 30 fps / 中文旁白与字幕 / 原创配乐和音效。

角色以用户侧栏参考图为准：大肥鱼、千金、小龙娘、大小姐、小猫娘、雌小鬼、夜猫。头像造型、顺序与配色统一到该参考；角色卡使用编号，不绑定模型品牌。功能镜头在视频画布内同步名称与头像，不修改仓库原始截图或应用中的个人数据。

## 交付文件

- `output/MoyuBot-Introduction-1080p.mp4`：H.264 + AAC 成片，画面已带字幕，另含可选择的中文字幕轨。
- `output/MoyuBot.zh-CN.srt`：独立字幕。
- `output/storyboard-contact-sheet.jpg`：逐镜预览图。
- `output/poster.jpg`：七角色封面。
- `output/master.wav`：48 kHz 立体声混音母带。
- `output/narration.wav`、`output/music.wav`、`output/effects.wav`：独立声音分轨。
- `STORYBOARD.md`：创意、逐镜脚本、旁白、声音设计与素材出处。
- `story.json`：时间轴和字幕的结构化数据。
- `film.js`：可确定性重绘、可任意跳转的 Canvas 动画。

## 预览

从仓库根目录运行：

```powershell
node media/moyubot-film/serve.cjs
```

打开终端打印的 `/media/moyubot-film/` 地址。支持播放、暂停、跳转、静音；空格播放，左右键跳转五秒。预览页读取已生成的 `output/master.wav`，需要先完成声音制作。不要直接双击 HTML：浏览器会限制本地 JSON 的读取。

## 重新制作

需要 Node.js 20+、Python 3.12+ 与已安装的 Chrome。渲染器优先读取本目录安装的 Playwright；当前桌面环境也可复用随 Codex 安装的 Playwright。

```powershell
cd media/moyubot-film
npm install
python -m pip install -r requirements.txt
python audio.py
node render.cjs --qa
node render.cjs
```

`audio.py` 优先查找仓库 `.work/video-tools` 下的 Python 依赖。在线旁白使用 Microsoft Xiaoxiao Neural；离线模式 `python audio.py --offline` 使用 Windows 已安装的 Microsoft Huihui Desktop。在线语音不可用时自动回退到该离线声音。

视频渲染器可通过环境变量 `MOYU_FFMPEG` 指向 FFmpeg；当前工程默认使用 `.work/video-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe`。独立安装时可用以下方式设置：

```powershell
$env:MOYU_FFMPEG = python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"
node render.cjs
```

修改文案与旁白时间在 `story.json`；修改具体画面、颜色、文字、角色动作在 `film.js`。当前镜头分界和总帧数同时在 `film.js` 与 `render.cjs` 固定；改变片长时应同步修改。分镜说明在 `STORYBOARD.md`。

成片与声音分轨保存在 `output/`，该目录已从 Git 排除，便于避免将大型生成文件混入源码提交。动画素材通过相对路径引用仓库中的角色、品牌图与截图，请保留仓库目录结构。

## 素材与权利说明

画面布局、动画编排、配乐与音效在本工程中制作。软件截图、Logo 与七套头像沿用当前仓库。角色路径和原始设计的来源、学习用途说明和授权边界沿用 `../../docs/ASSETS.md`，以及现有的 `LICENSE.ai-girl-bot`；此工程不为第三方造型添加新的商业使用或再分发许可。

预览页面、音频制作、视频编码均与产品主程序独立，不需改变应用现有实现。未执行发布、上传或修改线上官网。
