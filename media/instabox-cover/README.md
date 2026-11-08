# InstaBox 视频封面

主题：免费 4 核 8G 云服务器能拿来干嘛？

视觉语言沿用 `media/moyubot-film-v2/cover.js`（深蓝渐变 + 80px 网格 + 荧光绿强调 + 右侧产品窗口 + 漂浮标签），保证同一系列封面看起来是一套。

## 产出

`node render.cjs` 会起本地静态服务 + headless Chrome，把 `cover.js` 的 canvas 导出成：

| 文件 | 用途 |
| --- | --- |
| `output/InstaBox-4c8g-Cover-1920x1200.png` | B 站 16:10 封面（安全区居中） |
| `output/InstaBox-4c8g-Cover-1920x1080.png` | YouTube / 通用 16:9 封面 |
| `output/InstaBox-4c8g-960x600.jpg` | 列表页中等尺寸检查 |
| `output/thumbnail-320x200.jpg` | 手机端缩略图可读性检查 |

## 改文案

`cover.js` 里所有文案都是明文，主要位置：

- 品牌徽章：`免费 4 核 8G 云沙箱`
- 主标题：`4 核 8G` / `云服务器` / `能拿来干嘛？`
- 副标题：`跑 AI · 建站 · 挂机 · 远程桌面`
- 底部：`免费额度 · 开箱即用` + `instabox.sh`
- 窗口内终端：`$ instabox create --template universal`、`✓ machine ready · 28s`、`4 vCPU / 8 GiB 内存 / 20 GiB 数据盘`
- 漂浮标签：`Python` `Docker` `AI Agent` `Node.js` `远程桌面` `挂机`

浏览器直接打开 `cover.html` 可以预览（画布 1920×1200）。