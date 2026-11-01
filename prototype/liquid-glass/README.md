# 墨鱼 · Liquid Glass 移动端高保真原型

iOS 26 风格浅色液态玻璃，纯 HTML/CSS/JS，零依赖。八个屏幕：**会话列表 → 搜索 → 聊天详情 → Bot 资料页 → 定时任务 / 资料库 / 电脑（远程屏幕，深色）/ 已隐藏对话**；四个弹层：聊天「…」菜单、主页「+」菜单、**创建新 Bot**（形状/颜色实时预览，创建后进列表）、**新建群聊**（两步：选成员 → 叠放头像 + 命名）。

## 在 iPhone 上测试

1. 手机和电脑连**同一个 Wi-Fi**。
2. 电脑上运行：`node serve.mjs`（默认 8787 端口）。
3. iPhone Safari 打开终端里打印的 `LAN : http://192.168.x.x:8787`。
   - 首次访问如被拒，放行 Windows 防火墙提示，或手动执行：
     `netsh advfirewall firewall add rule name="moyu-proto-8787" dir=in action=allow protocol=TCP localport=8787`

真机安装（原生壳）不走 PWA：采用云端出包 + 免费 Apple ID 签名（AltStore / Sideloadly，7 天有效期自动续签）侧载到 iPhone。

## 已实现的液态玻璃细节

- 材质：`backdrop-filter` 多层半透明 + 高光描边（inset specular rim）+ 折射投影
- 高光跟随指尖：所有玻璃控件按下时镜面反光随手指位置移动
- 按压动效：快速压缩 → 弹簧曲线回弹（`cubic-bezier(.34,1.56,.64,1)`）
- 搜索打开：底部搜索药丸 **FLIP 形变**飞入顶部搜索位（非均匀 scale 拉伸 = 液态感）
- 分组筛选：黑色药丸在选项间弹簧滑动
- 进聊天：iOS 推入转场（当前页缩放退后），支持**边缘右滑返回**
- 消息瀑布弹入、输入模拟回复（打字气泡 → 回复）、子任务卡（旋转进度环 + 流光文字 + 可展开步骤）
- 首页 hero 滚动视差缩放；键盘弹出实时补偿（visualViewport）
- iPhone 全面屏安全区适配（`viewport-fit=cover` + `env(safe-area-inset-*)`）

## 结构

```
index.html   三屏结构 + 内联 SVG（头像/图标手绘）
styles.css   液态玻璃材质体系 + 动效
app.js       数据渲染、转场、FLIP、手势、键盘补偿
serve.mjs    零依赖静态服务器
```

## 后续路线

原型定稿后：移动端用 Expo/React Native 承接（`expo-glass-effect` 提供原生 Liquid Glass，iOS 26+），
日常开发用 Expo Go 热重载；真机包走云端构建 + 免费 Apple ID 签名（AltStore/Sideloadly 侧载），
推送与上架时再购买开发者账户。Android 端 Jetpack Compose（`RenderEffect` 模糊，Android 12+）。
两端共用本原型的设计 token（颜色、圆角、弹簧曲线、模糊半径）。
