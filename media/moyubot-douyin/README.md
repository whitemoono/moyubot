# MoyuBot · 抖音横屏图文七张

统一规格：1920×1080，16:9。首图为可编辑 Canvas 排版；其余六张使用落地页「客户端界面」的六个原始 PNG，保持完整比例，不裁切操作界面。

上传顺序：

1. 首图：Grok？让 AI 上班，你负责摸鱼；七角色、官网、完整仓库、Telegram、QQ、反馈与 Star 邀请。
2. 专属 Bot：`moyubot-landing/site/screenshots/chat.png`。
3. 多 Bot 群聊：`group.png`。
4. 例行任务：`tasks.png`。
5. 云电脑实时桌面：`cloud-desktop.png`。
6. 记忆与资料库：`library.png`。
7. 用量统计：`usage.png`。

页面原图属于落地页已经使用的客户端示例素材，没有伪造新界面或操作结果。用量图注明示例数据，云电脑页注明 InstaBox 邀请码限制、模型另配以及费用与试用规则；任务页注明应用运行条件。

`output/MoyuBot-Douyin-7-Images.zip` 只含按序命名的七张 JPG，可直接用于图文上传。`output/MoyuBot-Douyin-7-Images-PNG.zip` 是七张高清 PNG。`output/contact-sheet.jpg` 是预览拼图，不属于上传七图。

查看可编辑预览：<http://localhost:4318/media/moyubot-douyin/>。直接点击顶部七个页签切换。

修改 `design.js` 内的标题、说明、颜色与坐标，运行：

```powershell
node media/moyubot-douyin/export.cjs
```

脚本使用本机 Chrome 和 Playwright，导出 JPG / PNG 并检查文字边界与资源加载。原截图不变。之后可用 Python zipfile 或 PowerShell Compress-Archive 分别打包输出文件夹。
