# Docker 与站点接入

需要 Docker Compose。先用 `docker context ls` 确认目标，以下 `<context>` 必须替换为实际 context。

```sh
docker --context <context> compose up -d --build
```

默认只发布部署主机的 `127.0.0.1:3210`，在该主机浏览器访问 `http://localhost:3210/`。其他电脑通过 HTTPS 反向代理访问，设置 `PUBLIC_ORIGIN=https://你的游戏域名`，代理根路径与 `/socket.io/` 的 WebSocket Upgrade。网页、API、Socket.IO 共用一个端口，无 PeerJS、WebRTC、STUN/TURN 或 UDP。

| 环境变量 | 默认值/用途 |
| --- | --- |
| `HOST` | 本地 `127.0.0.1`；Docker `0.0.0.0` |
| `PORT` | `3210`，网页与联机共用 |
| `PUBLIC_ORIGIN` | 精确公开 HTTP(S) origin；用于 HTTP/WS Origin 校验 |
| `DATA_DIR` | 本地 `data/`；Docker `/data` |
| `ENABLE_DIAGNOSTICS` | 默认关闭；仅隔离验收 `1` 开启 `/local/status` |

`GET /health` 返回服务状态、在线人数和内存房间数。健康检查不能代替真实浏览器对局。容器使用非 root、只读根文件系统、持久数据卷及资源/日志限额。`docker compose down` 保留卷；不要使用 `down -v`，它会删除账户、地图、皮肤、键位、好友及回放。

SQLite 使用 WAL，新数据库总大小限制为 1 GiB；到达上限拒绝新写入并保留已有内容。备份前停止本款游戏，复制整个数据目录，再启动；或使用 SQLite 一致性备份。只复制运行中的 `.sqlite` 会遗漏 WAL。重启结束内存房间，卷和旧镜像不能恢复进行中的对局。

## BlackRoom

`deploy/blackroom.compose.yaml` 供现有站点部署使用：无宿主机端口，接入独立 `blackroom-games-bonk-backend`，只允许成员网关访问。需要先存在该网络并构建精确镜像。保持游戏 `id=bonk` 和 `origin=https://bonk.muwei.xyz`，将原登记条目的上游改为 `http://blackroom-rea-bonk:3210`，WS 规则改为 `[{"path":"/socket.io/","match":"prefix"}]`；保留完整清单其他游戏条目及原认证 key。

游戏读取同源 `GET /_blackroom/me` 的 `{username}` 填入真实游客昵称，允许手动修改，最多 60 个 Unicode 码点（120 UTF-16 单位）。资料失败留空手填，不恢复无法确认归属的旧昵称。游戏内账户是独立账户，只用于地图、皮肤等持久化，不授予论坛权限，也不使用论坛密码。

邀请使用 `/?id=<不透明房间 UUID>`，兼容旧本项目 `/?room=`，密码不进入链接。邀请仍经成员网关登录与授权。旧站点版本的六位房间码不能迁移为本项目的房间 UUID；切换时旧对局结束，已有讨论和站点用户名保留。

联机输入、开局、聊天、房间控制和房主提供的快照均经受成员门禁保护的 Socket.IO 服务。原物理仍由浏览器模拟，不能据此宣称服务器独立验证胜负或提供权威反作弊。

## 验收工具

```sh
npm ci
npm test
# 独立测试 Chrome 的 CDP 端口与实际游戏地址
DEBUG_PORT=19329 BONK_URL=http://127.0.0.1:3310/ node tools/browser-check.mjs
```

浏览器工具只操作指定的独立测试 Chrome，使用合成账户，输出到 `output/server-zh-20261014/`；不连接用户日常浏览器。`BONK_OUTPUT` 可指定证据目录。模式/快匹/账户/邀请回放/地图重载脚本使用相同环境参数，诊断型模式测试需在隔离服务设置 `ENABLE_DIAGNOSTICS=1`。正式服务保持诊断关闭。
