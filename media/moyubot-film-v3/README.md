# MoyuBot 产品介绍视频 · film v3

MoyuBot v0.1.4 的横屏产品介绍片。1920×1080（16:9）、30 fps、111 秒、H.264 + AAC，
中文旁白 + 烧录字幕 + 独立 SRT + 原创程序化配乐 + 合成音效。

成片：`output/MoyuBot-Introduction-v3-1080p.mp4`；字幕：`output/MoyuBot.zh-CN.srt`。

## 内容结构（111 s）

1. **钩子**（0–7.5）深夜加班 → 「换 AI 来。」七个团子弹入（WebGL 极光背景）
2. **品牌**（7.5–15.5）Logo / 品牌句 / 开源 · Windows · 多供应商标签
3. **工作空间**（15.5–28.5）Bot 阵容 + 固定对话 + 本地 / InstaBox 云电脑切换 + Bot 隔离目录
4. **Agent 循环**（28.5–43.5）工具卡流水（命令 / 读写 / 搜索 / 出图）+ 审批弹层 + 模式胶囊 + 上下文压缩
5. **共享云电脑**（43.5–57.5）挂起 → 按需唤醒 → 终端执行 → 自动休眠（InstaBox）
6. **七个 Bot 角色**（57.5–77.5）角色巡游大卡（真实头像引擎 + 口头禅 + 主题色）→ 全家福 + 状态表情演示
7. **群聊 + 子代理**（77.5–89.5）三 Bot 接力发言 + run_script 四路并行调研
8. **记忆 / 节奏 / 用量**（89.5–100）长期记忆 · 定时任务 · Token 仪表盘
9. **收尾**（100–111）Logo + 全家福挥手 + 官网 / GitHub / Telegram / QQ 群 + 「摸鱼愉快」

完整分镜（逐秒）、音乐结构、音效对位见 [STORYBOARD.md](STORYBOARD.md)。

## 技术要点

- **Remotion 4 + React 19**：所有界面、动画由代码绘制；`story.json` 是场景/旁白/音效的唯一事实源。
- **真实头像引擎**：`src/vendor/grok/` vendored 自应用内 `BotAvatar` 同款引擎（见 `docs/ASSETS.md`）。
  `GrokAvatar` 组件以 driven 模式从 t=0 固定步长重放到当前帧，`Math.random` 换成固定种子
  mulberry32 —— Remotion 乱序渲染每帧结果完全一致。
- **GLSL 极光背景**：`Aurora.tsx`（fbm 噪声 + 流动光带，时间由帧号驱动）。
- **音频**：`scripts/gen-audio.py` —— edge-tts（zh-CN-XiaoxiaoNeural，SAPI 兜底）旁白、
  numpy/scipy 原创配乐（108 BPM、七个段落对齐场景）、14 个合成音效；旁白时长自动校验是否与分镜吻合。
- **混音**：`Mixdown.tsx` 在 Remotion 内对位旁白与音效，配乐在人声窗口自动闪避（ducking）。
- 功能页左下角标注「操作流程演示 · 代码动画（示例数据）」，命令与结果为示例，无录屏、无真实密钥。

## 复现

```bash
cd media/moyubot-film-v3
pnpm install
python scripts/gen-audio.py        # 生成 public/audio + public/voice + SRT
pnpm run render                    # remotion render → output/MoyuBot-Introduction-v3-1080p.mp4
pnpm exec remotion studio --no-open  # 本地预览（每个场景有独立子合成）
```

改分镜：编辑 `story.json`（场景边界、旁白文本与时间、音效事件、角色卡）→ 重跑
`gen-audio.py`（校验旁白时长）→ 重新渲染。场景代码在 `src/scenes/`。

## 素材与授权

七个角色头像使用产品现有 vendored 角色素材（版权与限制见仓库 `docs/ASSETS.md`，
本片仅展示 MoyuBot 实际使用外观）；Logo 为产品原素材；其余画面、音乐、音效均为本项目原创代码产物。
