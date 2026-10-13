# bonk.io 客户端资源镜像

采集来源为 `https://bonk.io/`，仅使用 `GET` 下载静态客户端依赖；没有调用账户接口、创建房间或向 PHP 写入数据。

## 当前镜像

- `public/index.html` 与 `public/gameframe-release.html`：原始页面的本地副本。
- 27 个 manifest 中可定位到普通 URL 的脚本已按原路径复制到 `public/`，包括 `GameResources.js`、`alpha2s.js`、Pixi、Howler、PSON、Box2D 等。
- manifest 中 4 个 `layout=isolated` 的 HTML/root inline 脚本没有作为额外页面脚本加载；HTML 内原有 inline 代码仍由对应页面承载。
- HTML 直接引用资源：35 个（CSS、字体、图片）；CSS `url(...)` 依赖：51 个；本次镜像共 131 个实际资源文件；`public/` 另有已有的 `local-adapter.js`、`local-maps.json` 和 `.mirror-failures.txt` 清单文件。
- `GameResources.js` 中未发现可解析的外部图片、字体或音频 URL；其资源主要以内嵌数据形式存在。

## 处理记录

- 删除首页 Google Analytics (`googletagmanager.com`) 和 longitude 广告脚本 (`lngtd.com`)。
- 删除首页 hitbox.io、bonk.io、Supercar Stadium 游戏导航及广告容器，保留游戏区域、说明区域和本地 `gameframe-release.html` iframe。
- 移除首页 player-count/autojoin 的外站请求代码，避免镜像页面触发第三方读取或 POST。
- 将 game frame 顶层跳转映射到本地 `/`，避免独立打开 frame 时回到官方站点。
- 按 `runtime-dictionary.json` 和 `game.readable.js` 的确定 callsite 补齐动态资源：`sound/128_blc.mp3`、`128_mcg.mp3`、`128_vdp.mp3`、`128_wmb.mp3`、`bell_full_1.mp3`，以及 `graphics/host_0..5.png`、`ping_1..5.png`、`lock.png`、`readytick.png`、`flags/na.png`。
- color picker 两张官方 404 图片改为 CSS 原生渐变：色相条使用彩虹线性渐变，饱和度/明度面使用白色到透明与黑色到透明叠加；因此不再产生这两个 404 请求，控件交互所需的视觉渐变仍保留。
- Cloudflare email-decode 脚本随 manifest 保留，因为它是原页面导出的普通脚本；当前首页已移除对应外部邮箱导航。

## 失败清单

当前 `public/.mirror-failures.txt` 保留官方 404 的 `graphics/ping_0.png`；当前实际 UI 使用的 `ping_1..5.png` 已齐全。此前官方 404 的两个 color picker 图片已由 CSS 原生渐变替代，不再属于依赖。没有用空文件占位；后续若某资源下载失败，应继续保留 URL 到该文件。

## 真实资源清单与未满足依赖

动态资源清单以实际文件为准：

| 类别 | 本地路径 | 来源/调用点 |
| --- | --- | --- |
| 音频 | `public/sound/128_blc.mp3`, `128_mcg.mp3`, `128_wmb.mp3`, `128_vdp.mp3` | `startMusic()` 的季节/普通音乐选择 |
| 音频 | `public/sound/bell_full_1.mp3` | 倒计时 Howler 初始化 |
| 图片 | `public/graphics/host_0..5.png`, `ping_1..5.png`, `readytick.png` | 房间列表/准备状态动态 `Image.src` |
| 图片 | `public/graphics/lock.png`, `flags/na.png` | 锁定状态与默认服务器国家动态 `Image.src` |

未满足的客户端依赖：

- `graphics/ping_0.png` 当前官方返回 404，已保留在 `.mirror-failures.txt`；`ping_1..5`、`host_0..5` 和 `flags/na.png` 已下载。
- `GameResources.js` 的 `soundStrings` 与 `svgStrings` 主要是 `data:` 内嵌值，不另行拆出下载文件。
- 账户、实时房间、网络 socket、远端 PHP 接口和服务端返回的地图/旗帜资源不属于静态镜像。

## 边界

资源镜像只覆盖 HTML、CSS、字体、图片和已导出的客户端脚本。静态镜像本身不包含服务端能力。当前游戏的本地账户、实时房间、匹配与回放由 `server/` 独立重建，原服数据和第三方广告没有迁移。
