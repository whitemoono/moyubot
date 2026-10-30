# MoyuBot 私有 PWA 与同步服务

每个用户部署自己的服务，填写自己的域名和连接密钥。软件没有默认公共服务器。
桌面未配置时不发起同步请求，手机未配对时不上传。此目录可单独复制部署，不依赖桌面 workspace。

## Docker 部署

准备自己的域名并解析到服务器。在此目录执行：

```sh
cp .env.example .env
openssl rand -hex 32
```

编辑 .env，填入自己的 PWA_DOMAIN、PUBLIC_ORIGIN 和随机生成的 SYNC_SETUP_KEY（至少 32 字符），
将 SYNC_ENABLED 改为 true。PUBLIC_ORIGIN 只含协议、域名和可选端口，不带子路径。
生产使用 HTTPS，本机调试可使用 HTTP localhost。密钥不要提交仓库或公开；不要使用 SSH 密码。

全新服务器，80/443 无占用时自动 HTTPS：

```sh
docker compose -p moyubot-pwa -f compose.yaml -f compose.https.yaml up -d --build --wait
```

已有 nginx：

```sh
docker compose -p moyubot-pwa up -d --build --wait
```

入口默认仅绑定宿主机 loopback:8090，sync:8081 仅在 Docker 内网开放。
参考 deploy/pwa.nginx.conf，将示例域名和证书路径替换成自己的，再 nginx -t 和 reload。
已有 stream/SNI 路由时使用空闲 loopback TLS 端口并增加映射，保留其他站点。
SSE 反代关闭缓冲，读取超时超过 25 秒。

## 客户端连接

1. 桌面头像 → 连接手机：填写自建服务器地址和部署时设置的连接密钥。
2. 测试连接、保存服务器，生成二维码。
3. 手机打开同一服务器的 PWA，在「我的 → 连接电脑」扫码，电脑确认。
4. 两端各自手动开启「实时同步到服务器」。
5. 桌面连接弹窗的「手机聊天与云电脑」里勾选服务商、可选云电脑，并明确同意保存到当前服务器。
6. 手机上点击聊天顶部的模型名选择服务商和模型，发送消息；工作台的「云电脑」可读写文本文件、执行命令。

二维码五分钟有效、单次使用、本机生成；凭据放在 fragment，接收后移除。
二维码域名必须与当前手机 PWA 一致，配对凭据不转发给其他站点。
服务器地址保存在本机；连接密钥和设备凭据通过 Electron safeStorage 保存。
手机数据存于当前 origin 的 IndexedDB，清除网站数据会清除未上传内容。

更换服务器先暂停同步，备份旧同步状态并重置设备凭据和游标，保留本地对话。
新的服务器需重新配对并主动开启上传。旧版未明确配置服务器的连接不会自动恢复，
旧状态留在本机备份，不继续向旧服务器上传。

## 同步范围与隐私

同步伙伴资料、角色提示词、对话文本、长期记忆、用户名、桌面任务状态。
API Key、服务商附加鉴权头和云电脑凭据不进入普通同步数据，只有桌面明确授权后才通过独立接口保存。
服务器 AES-256-GCM 加密保存执行配置，手机仅能读取不含凭据的模型目录。选择保存会替换原授权；
桌面修改服务商、模型或云电脑配置后需重新授权。删除执行凭据会停止相应任务，后续无法再调用。
原电脑本机路径、MCP 配置、附件文件和费用记录不上传。
任一端单独在线都能上传，对方下次打开补齐；断网本机排队，系统挂起时不持续运行。
同时编辑保留冲突版本，新消息按独立 ID 合并。
手机发送由服务器调用 OpenAI 兼容、Anthropic 或 Gemini 接口；桌面关闭后仍能生成回复。
手机断网消息写入当前设备 IndexedDB，恢复联网且同步开启后自动提交；请求标识防止重复执行。
服务器后台生成，手机暂时关闭后仍可继续；服务器重启会明确标记中断，不自动重跑模型或工具。
授权的 InstaBox 云电脑支持状态、唤醒/休眠、文本读写、命令执行；模型只可使用桌面已选中的
cloud_exec/read/write 工具。命令和写入会在手机提示确认，等待两分钟自动拒绝。读取使用已授权权限。
原电脑本地执行环境、MCP、群聊执行、图片/附件与服务器定时任务未接入；桌面任务仍由原电脑执行。
手机私聊可使用本地伙伴的角色和模型，但不能访问该伙伴的本机文件。同步历史不会触发执行。

HTTPS 保护传输，数据库由用户自己管理。加密主密钥 /data/execution-master.key 和数据库应一起备份，
丢失主密钥后无法解密已授权凭据；该文件权限为 0600。服务器管理员仍可解密凭据和读取对话，当前未实现端到端加密。
服务器与备份应按私有数据管理。

## 预览站模式

SYNC_ENABLED 默认为 false；仅演示外观时无需 origin 或连接密钥。
健康检查返回 syncEnabled:false，创建工作空间、配对和同步接口拒绝请求。
界面演示与私有测试部署是两种配置：只展示外观时关闭同步；部署者自己测试配对与同步时，
设置自己的 PUBLIC_ORIGIN、连接密钥并显式启用即可。测试部署不会成为其他客户端的默认服务器。
已有数据卷保留而不自动删除。

## 本地开发

```sh
npm ci
npm run build
npm run preview
```

独立同步服务使用 Node 24。开发时设置 SYNC_ENABLED=true、测试用 SYNC_SETUP_KEY、
浏览器 PUBLIC_ORIGIN 后运行 node server/index.mjs。Vite dev 代理 /api 到 localhost:8081。
server/runtime/ 随部署目录提供，与桌面共用的模型和云电脑适配器已编译为独立运行版本；不依赖根目录。
修改核心适配器后，在仓库根目录执行 node scripts/prepare-pwa-runtime.cjs 更新，再构建服务器镜像。

## 备份、更新与恢复

Compose project 为 moyubot-pwa 时数据卷为 moyubot-pwa_sync_data，数据库在 /data/sync.sqlite（WAL）。
更新前保留源码、配置和镜像，重新构建并 up -d --wait。不要执行 down -v，它会删除数据卷。

```sh
mkdir -p ./backups
docker compose -p moyubot-pwa stop sync
docker cp moyubot-pwa-sync-1:/data ./backups/data-YYYYMMDD
docker compose -p moyubot-pwa start sync
```

恢复时停止 sync，把备份的整个 data 目录复制回 /data，确保 UID/GID 1000 可写后启动。
SQLite 与 WAL/SHM 组合保持一致。静态 PWA 在 sync 停止时仍能打开。
检查 /healthz、/api/health、/manifest.webmanifest 和 /sw.js。
Service Worker 只缓存公开应用壳，API、凭据和对话不进入 Cache Storage。
