# MoyuBot 落地页部署记录

域名：`https://moyubot.net`（A 记录 → 62.106.75.119）
服务器：Ubuntu 26.04，root@62.106.75.119:22
部署时间：2026-10-28

## 拓扑

```
公网 :443 (nginx stream, SNI 分流)
 ├─ tk.chch.eu.org → 127.0.0.1:2443 (sing-box，代理不动)
 ├─ www.bing.com   → 127.0.0.1:3443
 └─ moyubot.net    → 127.0.0.1:8444 (nginx http vhost, TLS 终结)
                        └─ proxy_pass → 127.0.0.1:8088 (docker 容器 nginx:alpine)
公网 :80 → nginx（moyubot.net 301→https，ACME webroot，未知 Host 一律 444）
```

- 443 与已有代理通过 nginx `stream` + `ssl_preread` SNI map 共用（在
  `/etc/nginx/stream.d/00-sni-map.conf` 的 `PSM:ENTRIES` 区块加了一行
  `moyubot.net   127.0.0.1:8444;`）。
- Docker 容器只绑定 `127.0.0.1:8088`，不暴露到公网。

## 组件

| 组件 | 位置 |
| --- | --- |
| 站点源码 | `site/`（index.html + bg.jpg + logo.webp） |
| 容器镜像 | `moyubot-landing:latest`（nginx:alpine） |
| 容器 | `moyubot-landing`，`restart: unless-stopped`，healthcheck 通过 |
| compose | `compose.yaml`（映射 `127.0.0.1:8088:80`） |
| 服务器目录 | `/opt/moyubot-landing` |
| TLS 证书 | `/etc/nginx/ssl/moyubot.net/`（Let's Encrypt, EC-256） |
| nginx vhost | `/etc/nginx/conf.d/moyubot.net.http.conf`（:80）、`moyubot.net.https.conf`（:8444） |

## 证书

- 签发：acme.sh webroot 模式（`--webroot /var/www/letsencrypt`），已安装到
  `/etc/nginx/ssl/moyubot.net/`，reloadcmd 为 `systemctl reload nginx`。
- 续期：已有 root crontab `acme.sh --cron`（每天 3/9/15/21 点），到期前自动续
  期并 reload nginx。证书目录 `~/.acme.sh/moyubot.net_ecc/`。

## 更新站点

```bash
# 本地改好 site/ 后：
scp -r site root@62.106.75.119:/opt/moyubot-landing/
ssh root@62.106.75.119 'cd /opt/moyubot-landing && docker compose up -d --build'
```

## 回滚 / 下线

```bash
ssh root@62.106.75.119 'docker compose -f /opt/moyubot-landing/compose.yaml down'
# 并删掉 /etc/nginx/conf.d/moyubot.net.*.conf 与 stream map 中 moyubot.net 行
```
