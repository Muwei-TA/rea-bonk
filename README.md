# Bonk Local

可在本机独立运行的 bonk.io 兼容复现。保留采集到的原客户端物理、渲染、声音、菜单、地图和皮肤编辑器；重建本地账户 API、房间协议、匹配和 PeerJS 信令服务。它是原客户端加兼容服务端，服务端由客户端契约推导实现，并非恢复出的官方后端源码。

## 启动与游玩

需要 **Node.js 24 或更新版本**。

```sh
npm install
npm start
```

打开 <http://127.0.0.1:3210/>。服务监听 `127.0.0.1`，网页与 Socket.IO 使用 3210，PeerJS 使用 3211。无需官方账号、外部数据库、STUN 服务或联网游戏服务器；首次安装 npm 依赖需要网络。使用 `PORT=3310 npm start` 可同时改为 3310 / 3311。

- 同一台电脑打开两个浏览器窗口，选择不同游客昵称；或创建新的本地账号。
- PLAY → Custom Game → Create；另一窗口从房间列表加入，也可打开房间链接按钮生成的邀请链接。密码房间在加入时输入密码。
- 方向键移动，X / Shift / Space 增重；各模式的其他按键由原客户端帮助提示，支持修改并保存键位。
- Quick Play 的 Classic、Arrows、Grapple 和 Simple 四个入口均可自动创建或匹配本地对局。Classic、Arrows、Death Arrows、Grapple、VTOL、Football 保留原玩法。Football 开局前加入红、蓝队。
- Map → PICKS 提供 97 张原客户端内置社区地图，保留原作者署名；Editor 制作地图，本地账号可以保存、重载、发布或设为私有。公开地图进入本地搜索、HOT、收藏和投票。
- SKINS 支持编辑与保存 5 个槽位；FRIENDS 支持申请、接受、在线房间显示与取消关系。
- 有效游戏进行至少 5 秒后，点击顶部回放按钮录制最近片段；主菜单播放本地回放。沿用原限制：重录间隔 15 秒，足球不支持回放。

账户、地图、皮肤、键位、好友、投票和回放写入 `data/local-bonk.sqlite`。重启保留数据，运行中的房间不持久化。`DATA_DIR=/absolute/path npm start` 可指定数据位置。备份前停止服务，或使用 SQLite 的一致性备份；不要只复制运行中数据库而遗漏 WAL。

## 验收

`npm test`：14 项真实 HTTP / Socket.IO 回归全部通过，覆盖账号持久化、所有权、好友隐私、密码并发撤销、地图与回放契约、房主权限及移交、输入转发、房间关闭、游客封禁重连、经验值去重。

另用独立 Chrome 配置实际操作原界面，记录以下证据；浏览器验收不是上述单元测试的替代。

| 流程 | 验收结果 | 证据 |
| --- | --- | --- |
| 自定义双人联机 | GUI 创建/加入、聊天、真实 P2P、方向键移动；同帧玩家物理状态相等 | `output/playwright/browser-results.json` |
| 六种模式 | 两客户端真实开局与渲染；同帧状态相等，Football 有球 | `output/playwright/modes-results.json` |
| 快速匹配 | 四个入口均自动建房开局，第二人匹配进入进行中的对局，快照与 P2P 正常 | `output/playwright/quick-results.json` |
| 账户与编辑 | 注册、登录、皮肤保存/刷新回读、好友申请/接受；原编辑器绘制平台与出生点并保存 | `output/playwright/account-results.json` |
| 地图重载 | MY MAPS 原界面加载保存地图；平台和出生点保留，日期正确 | `output/playwright/map-reload-results.json` |
| 邀请与回放 | 本地链接通过原加入流程进入房间；录制真实对局并在主菜单播放 | `output/playwright/invite-replay-results.json` |
| 内置地图 | 97/97 经过原 loader，有自由出生点且没有 backupMap fallback | `docs/protocol.md` |

截图在 `output/playwright/`。`tools/*browser-check.mjs` 使用专用 Chrome 调试端口 19327；不会连接日常 Chrome。重跑需启动独立 Chrome 并开放该本机端口。账号验收数据已在停服后移至 `output/playwright/fixture-data/` 留档，交付运行数据为空。这个目录含合成测试账号的数据库，应作为本地验收材料保留，不作为网站静态资源发布。

## 实现与调查文件

- `public/`：静态资源镜像、本地网络适配器、原始客户端与地图池。
- `server/index.mjs`：静态服务、同源限制、本机端口与少量内存补丁；`public/js/alpha2s.js` 原始文件不改写。
- `server/api.mjs` / `store.mjs`：SQLite、scrypt 密码、散列会话令牌、PHP 路径兼容接口。见 `docs/api.md`。
- `server/realtime.mjs`：Socket.IO EIO3 兼容房间服务；协议与差异见 `docs/protocol.md`。
- `docs/assets.md`：镜像来源、补齐资源与失败记录。
- `docs/investigation.md`：最初只读逆向报告的历史快照，里面的“未完成”描述对应那个阶段。
- `artifacts/`：REA 原始 evidence、脚本导出与 SHA-256、去混淆分析副本；不作为运行时依赖。

核心原文件 SHA-256：`e549ed7b6840a908bc0e9c595321aa5e9dcfa787190bae9b60938e32dfa65c8e`。内存补丁只处理本地地址、混淆器部署域名检查、UTC 日期、邀请入口、原菜单未绑定的 Simple/Grapple 快匹处理器和诊断状态。Box2D 物理、模式规则和地图编解码仍使用采集客户端。

## 范围与限制

- 原服账号、社区历史地图库、排行榜、邮件恢复、Bonk 1 迁移和官方策展管理未迁移；不支持的接口明确返回 `unsupported`。内置地图有原作者署名，自己的公开地图在本地数据库中维护。Simple 快匹以 Classic、Balance、Altum 三张内置图作为本地初始池，也接收本地发布的 Simple 地图；没有冒充官方训练图策展列表。
- 本地经验值规则：注册玩家在开局至少 3 秒后报告获胜，每次开局最多领取一次 100 XP；与原 UI 的 `+100xp` 一致。服务器不运行权威物理，不能证明胜利报告真实，也不声称还原了官方反作弊和发奖算法。
- 游客封禁绑定当前标签页的持久游客 ID；清除该标签页会话或新开标签页可以换身份。本地注册账户按账户 ID 封禁。原 Mute 只在本人客户端屏蔽聊天。
- 仅验证同机 Chrome。未验收手机、跨机器公网/NAT、8 人满房长时间压力、断网回滚和加入途中房主离开的竞态。当前 WebRTC 没有 TURN，也不开放局域网或公网；跨机器部署需要单独做信令、HTTPS、网络和安全验收。
- 保留原客户端的动态执行与 WebGL 需求。本地 HTML 的来源说明已更新，运行验收未发现游戏流量逃逸至官方服务；广告与统计已移除。
- 原静态素材和脚本仍受原作者权利约束。仓库 `private`，本次没有公开发布或声称取得商业再分发授权。
