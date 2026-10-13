# Bonk 原始客户端本地服务器协议

证据来源：本仓 `artifacts/derived/game.readable.js`，数字表与网络适配器 `D` 位于 14925–16245 行；调用方位于 1331、2149、2547、2734、2856、3071、3104、45091、45323 行。`runtime-dictionary.json` 是已提取的运行时字符串字典。本调查未连接官方房间、建房或发送聊天；下面标为“确定”的参数来自实际客户端调用及接收实现，转发策略是本地兼容服务器设计，未声称还原官方服务端内部逻辑。

## 关键规则

- C 表示客户端到服务器，S 表示服务器到客户端。两个方向使用独立数字表，同一个数字通常不是同一事件。
- S 事件多数使用多个位置参数，例如 `socket.emit(15, startTime, initialState, settings)`；不要包成单个数组参数。
- 玩家编号是房间内数组索引，从 0 开始，离开后保留 `null` 空位，不能重排现有编号。
- 物理初始状态、地图编码、回滚模拟由原客户端负责。服务器无需重新实现 Box2D 或解码 PSON 即可支持本地联机；透明转发压缩字符串。
- 创建者不会收到普通加入流程来初始化自身。S2 会把其本地编号固定为 0，`hostID` 初值也为 0。不要给创建者额外发 S3，否则可能重复初始化。
- 原客户端在 Socket.IO 时钟同步完成且 PeerJS `open` 后才请求创建/加入。本地若仅使用 Socket.IO，需要令本地 Peer 适配器触发 `open`，并禁用 P2P；单纯设置 `D.np=true` 不会跳过等待 PeerJS open。
- `disconnect` 是离开事件的来源，原客户端未定义数字 leave 请求。

## 最小完整流程

### 1. 时钟同步

每个 Socket.IO 连接发出 C18 `(data, acknowledgement)`，`data` 是 timesync 的 JSON-RPC 请求，例如：

```js
// C18
{jsonrpc: "2.0", id: "request-id", method: "timesync"}
// server
acknowledgement();
socket.emit(23, {jsonrpc: "2.0", id: data.id, result: Date.now()});
```

`id` 原样返回，`result` 是 Unix 毫秒时间。客户端的 timesync 配置为 interval=10000、delay=250，库默认 repeat=5。必须同时处理 acknowledgement 和 S23，单独 ack 不会完成同步。证据：14988–15034 及本地 `js/timesync.min.js` 的 `receive` / `_getOffset`。

### 2. 创建房间

C12 单个对象：

```js
{
  peerID: "local-peer-a", roomName: "Local room", maxPlayers: 8,
  password: "", dbid: 0, guest: true, minLevel: 0, maxLevel: 999,
  latitude: 0, longitude: 0, country: "na", version: CLIENT_VERSION,
  hidden: false, quick: false, mode: "custom", guestName: "Alice",
  avatar: CLIENT_AVATAR
}
```

非 guest 则使用 `token` 替代 `guestName`；`extraParams` 会按 `{i,v}` 展开为额外顶层字段。`quick` 是布尔值，`mode` 是 quick 类型或 `custom`。`D.np` 生效时 create payload 的 peerID 是空字符串。

服务端建立 player 0，然后发送：

```js
socket.emit(2, ROOM_ID, 1, null); // arg0 原客户端忽略，arg1=team，arg2=可选 quick maps
socket.emit(49, ROOM_ID, "");   // 设置 autoJoinID / autoJoinPassBypass
```

普通房间使用 team=1；team=0 为观众。创建者会用自己的用户名、等级、avatar 构造本地 player 0，显示大厅，初始地图由客户端选择。普通房间 S2 第三参数应为空，避免调用不存在的 quick map 管理器。

### 3. 第二个客户端加入

C13 单个对象：

```js
{
  joinID: ROOM_ID, roomPassword: "", guest: true, dbid: 2,
  version: CLIENT_VERSION, peerID: "local-peer-b", bypass: "",
  guestName: "Bob", avatar: CLIENT_AVATAR
}
```

原客户端 join 的 `dbid` 固定为 2，不能把这个字段当成已验证身份。服务端构造所有当前玩家数组（包括新加入者自身）：

```js
const players = [
  {peerID:"local-peer-a", userName:"Alice", guest:true, level:1,
   team:1, ready:false, tabbed:false, avatar:avatarA, ping:0},
  {peerID:"local-peer-b", userName:"Bob", guest:true, level:1,
   team:1, ready:false, tabbed:false, avatar:avatarB, ping:0}
];
newSocket.emit(3, 1, 0, players, 0, null, ROOM_ID, "", null);
//             localID,hostID,players,startTime,unused,autoJoinID,bypass,quickMaps
oldSocket.emit(4, 1, "local-peer-b", "Bob", true, 1, 1, avatarB);
```

avatar 必须使用客户端请求携带的实际对象，不要自行猜造简化对象。S3 的 `startTime` 大厅可使用 0；正在游戏时必须使用当前对局实际 startTime。S3 先发给新人，S4 再发给既有成员；S4 不发给新人自身。

房主接到 S4 后会自动回应 C11 `{sid:1, gs:settings}`，服务器**仅转发到目标新人** S21 `(settings)`。这一步才触发新人 `fullyJoined`；遗漏则 6 秒后出现 initial data timeout。

大厅 `settings.map` 是原始地图对象，不是字符串。默认 settings 构造：

```js
{map: RAW_MAP_OBJECT, gt:2, wl:3, q:false, tl:false, tea:false,
 ga:"b", mo:"b", bal:[]}
```

不要服务端伪造地图；C11 携带的设置直接转发即可。

### 4. 开局与输入

房主按 START，原客户端生成 C5 `{is:ENCODED_INITIAL_STATE, gs:SETTINGS_WITH_ENCODED_MAP}`。服务器保存开局时间，并向**全部成员，包括房主**发送：

```js
io.to(room).emit(15, Date.now(), data.is, data.gs);
```

客户端自身调用 `createNewState`、PSON 编码、LZString 编码；S15 接收端自行解码并开始 30Hz 模拟。`is` 应逐字不改，`gs.map` 此时为地图编码字符串。不要将大厅的原始 map 覆盖它。客户端依赖原样相同的 `startTime` 计算经过时间。

每位玩家 C4 `{i:bitmask,f:frame,c:sequence}`，服务端向同房其他成员 S7 `(senderID, originalPayload)`。`c` 是每连接从 0 单调增长的去重序号；保留 `f` 和 `c`。输入掩码：left=1、right=2、up=4、down=8、action=16、action2=32。不按帧重采样，不把 i 解码成对象，接收端自行 `decodeInputs`。

### 5. 游戏进行中加入

S3 的 startTime 为原有开局时间，S4 发给房主；房主自动 C40：

```js
{sid: targetID, allData: {
  state: ENCODED_STATE, stateID: snapshotFrame, fc: currentFrame,
  inputs:[{p:playerID,f:frame,i:bitmask}],
  admin:[{f:frame,a:adminEvent}],
  gs: SETTINGS_WITH_ENCODED_MAP, random: RANDOM_MAP_ORDER
}}
```

服务器向 targetID 发 S48 `(allData)`；同时照常转发输入、管理员事件。客户端在等待快照期间缓存输入与管理员事件。快照通常来自 `max(currentFrame-120,0)`；服务器应保留所有字段。新玩家实际入场由房主 C25 管理员事件控制。

## C → S 全部数字事件

表中 `()` 表示无参数； `{...}` 为一个 JSON 对象。S 列是本地服务器对应转发建议，非对官方服务器实现的断言。

| ID | 方法 / 入参 | 对应 S / 处理 |
|---:|---|---|
| 1 | ping reply `{id}` | 记录 RTT；S1 的 challenge |
| 2 | testPing `()` | 可发 S1 |
| 3 | getDebug `()` | 可忽略 |
| 4 | sendInputs `{i,f,c}` | S7(senderID,payload)，其他成员 |
| 5 | triggerStart `{is,gs}` | 仅房主；S15(startTime,is,gs)，全体 |
| 6 | changeOwnTeam `{targetTeam}` | 验证 teamLock；更新自己，S18(id,team) |
| 7 | doTeamLock `{teamLock}` | 仅房主；S19(bool) |
| 8 | silencePlayer `{muteID,muteType,action}` | S10 / S11(id,muteType)；action 取值需按调用方核对 |
| 9 | ban/kick `{banshortid,kickonly}` | 仅房主；S24(id,kickonly)，断开目标 |
| 10 | chatMessage `{message}` | S20(senderID,message)，全体 |
| 11 | informInLobby `{sid,gs}` | 仅房主；S21(gs) 给 sid |
| 12 | createRoom `CREATE_OBJECT` | S2；详见上文 |
| 13 | joinRoom `JOIN_OBJECT` | S3，既有成员 S4 |
| 14 | sendReturnToLobby `()` | 仅房主；S13() 全体 |
| 15 | 未定义 | 不使用 |
| 16 | setReady `{ready}` | 更新自己；S8(id,ready) |
| 17 | allReadyReset `()` | 仅房主；S9() |
| 18 | timesync `(rpc,ack)` | ack(); S23(response) |
| 19 | sendMapReorder `{s,e}` | S25(s,e) |
| 20 | sendGAMO `{ga,mo}` | S26(ga,mo) |
| 21 | sendWL `{w}` | S27(w) |
| 22 | sendMapDelete `{d}` | S28(d) |
| 23 | sendMapAdd `{m}` | S29(encodedMap) |
| 24 | sendTyping `()` | S30(senderID)，其他成员 |
| 25 | sendAdminInputs `{a,f}` | 仅房主；S31(payload) |
| 26 | changeOtherTeam `{targetID,targetTeam}` | 仅房主；S18(targetID,targetTeam) |
| 27 | sendMapSuggest `{m,mapname,mapauthor}` | S33(encodedMap,senderID) 给房主；S34(mapname,mapauthor,senderID) 给其余成员 |
| 28 | sendChangeMode `(modeString)` | 仅房主；S35(modeString) |
| 29 | sendBalance `{sid,bal}` | 仅房主；S36(sid,bal) |
| 30 | versionCheck `()` | S37(response)，客户端未消费 |
| 31 | sendDebugWinner `{wid}` | S38 参数待核实 |
| 32 | sendTeamSettingsChange `{t}` | S39(t) |
| 33 | sendArmRecord `()` | S40(senderID)，全体记录回放 |
| 34 | sendHostChange `{id}` | 仅房主；S41({oldHost,newHost}) |
| 35 | sendFriended `{id}` | S42(senderID) 给目标 |
| 36 | sendStartCountdown `{num}` | 仅房主；S43(num) |
| 37 | sendAbortCountdown `()` | 仅房主；S44() |
| 38 | sendReqXP `()` | S46({newXP,newToken?})；本地不接入官方账号 |
| 39 | sendMapVote `{mapid,vote}` | S50(mapid,vote) |
| 40 | informInGame `{sid,allData}` | 仅房主；S48(allData) 给 sid |
| 41 | getPreVote `{mapid}` | S50(mapid,savedVote) |
| 42 | getMoreQuickPlayMaps `{sf}` | S51(maps) |
| 43 | updateRC `{rc}` | 保存 quick 当前轮次 |
| 44 | tabbed `{out}` | 更新自己；S52(senderID,out) |
| 45 | desyncTest `{sid,a}` | sid 在此是请求 state/frame ID；S53(requesterID,sid,a) 给待比较客户端，目标选择未确定 |
| 46 | sendDesyncRes `{rid,sid,s,a}` | rid=requesterID，sid=frame/state ID，s=压缩state或null；S54(responderID,s,sid) 给请求者，null不得直接转发 |
| 47 | roundComplete `{mo,mid}` | 可记录轮次；无必需响应 |
| 48–49 | 未定义 | 不使用 |
| 50 | sendNoHostSwap `()` | 房主点击 End Room；随后断开时关闭房间而不迁移房主 |
| 51 | sendCurate `{mapid,dbv,comment}` | S57(success,errorCode) |
| 52 | sendRoomNameUpdate `{newName}` | 仅房主；S58(newName) |
| 53 | sendRoomPassUpdate `{newPass}` | 仅房主；S59(hasPassword)；是否官方传 bool 或密码未确定，客户端只作真值判断 |
| 54–60 | 未定义 | 不使用 |

## S → C 全部数字事件

| ID | 参数（按位置） | 客户端含义 |
|---:|---|---|
| 1 | pingMap, challengeID | 更新各玩家 ping；立即 C1 {id:challengeID} |
| 2 | unused, ownTeam, quickMaps? | 创建成功，localID=0 |
| 3 | localID,hostID,players,startTime,unused,autoJoinID,bypass,quickMaps? | 加入成功，尚需 S21/S48 |
| 4 | id,peerID,userName,guest,level,team,avatar | 新玩家；房主发送初始数据 |
| 5 | id,frame | 玩家离开；frame 用于游戏管理事件 |
| 6 | oldHostID,newHostID,frame | 房主离开，替换 hostID |
| 7 | senderID,{i,f,c} | 玩家输入 |
| 8 | id,ready | 准备状态 |
| 9 | () | 全员取消准备 |
| 10 | id,muteType | 玩家静音 |
| 11 | id,muteType | 取消静音 |
| 12 | id,newName | 改名 |
| 13 | () | 返回大厅 |
| 14 | ignoredValue | 接收但未消费 |
| 15 | startTime,encodedInitialState,settingsWithEncodedMap | 开局 |
| 16 | statusText | 状态提示 |
| 17 | {a:jsonString,b:jsonString} | 解析但无后续消费 |
| 18 | id,team | 队伍变化 |
| 19 | locked | 队伍锁定 |
| 20 | id,message | 聊天 |
| 21 | settingsWithRawMap | 加入大厅初始设置 |
| 22 | 未注册 | 不使用 |
| 23 | timesyncRpc | 时钟应答 |
| 24 | id,kickonly | kicked 通知；当前 handler 只给房主显示提示 |
| 25 | startIndex,endIndex | 地图重排（旧列表能力） |
| 26 | ga,mo | 游戏类型与模式 |
| 27 | winsLimit | 修改 wl |
| 28 | mapIndex | 删除地图；当前 handler 立即 return |
| 29 | encodedMap | 解码后替换当前 map |
| 30 | id | typing |
| 31 | {a,f} | 管理员帧事件 |
| 32 | () | AFK 警告 |
| 33 | encodedMap,suggesterID | 给房主的地图建议 |
| 34 | mapName,mapAuthor,suggesterID | 面向成员的建议通知 |
| 35 | mode | 修改 mo |
| 36 | id,balance | 修改 bal[id] |
| 37 | ignoredValue | 接收但未消费 |
| 38 | winnerID,unknown | debugWinner，调用方当前只查两名玩家 |
| 39 | teamsEnabled | 修改 tea |
| 40 | requesterID | armRecord |
| 41 | {oldHost,newHost,...} | hostChange |
| 42 | playerID | friended |
| 43 | countdownNumber | countdown |
| 44 | () | countdownaborted |
| 45 | {sid,lv} | playerLevelledUp |
| 46 | {newXP,newToken?} | 本地 XP；newToken 可选 |
| 47 | frame | localRevert，本地玩家输入回滚 |
| 48 | allData | 游戏中加入，见上文 |
| 49 | autoJoinID,bypass | 更新自动重连/链接信息 |
| 50 | mapID,vote | mapsVotedFor[mapID]=vote |
| 51 | quickMaps | onMoreQuickMaps |
| 52 | id,tabbed | 切后台状态 |
| 53 | requesterID,stateFrame,a | 请求该帧压缩状态 |
| 54 | responderID,encodedState,stateFrame | 接收对比状态；encodedState 必须非null |
| 55–56 | 未注册 | 不使用 |
| 57 | success,errorCode | curateResult |
| 58 | newName | 房间名变化 |
| 59 | hasPassword | 房间密码是否存在（客户端只读真值） |
| 60 | message | serverMessage |

## 管理员事件、编码与待确认项

`a` 原样传递。已确认游戏中入场/离场使用 `playersJoined` / `playersLeft`，对应 frame `f`；`playersJoined` 的元素是 `{id:playerID,t:team}`，同时 `a.pc` 为当前玩家数量；玩家离开 S5/S6 接收端也会排入管理事件，因此不要同时人为制造重复离场。房主发送 C25 的典型管理员对象包含 `playersLeft:[]`、`playersJoined:[...]`，具体加入成员内容由客户端生成。

状态编码顺序：`PSON.encode(state).toBase64()` → `LZString.compressToEncodedURIComponent()` → 对索引 0..100（包含 100）的字母交换大小写。地图使用客户端 `Y.encodeToDatabase` / `Y.decodeFromDatabase`；状态编码与地图编码不可混同。服务器透明转发，不需要编码器。

本地兼容服务必须检查调用者属于该房间、目标 sid 存在、房主专属事件实际来自房主。消息中的 id/sid 不能用于跨房间路由；控制变更更新服务端 player/settings 元数据，再广播，否则后来的 S3 会带旧队伍等状态。

已确定核心 E2E 消息契约；尚未以本文单独运行双客户端验收。待父任务实际浏览器验收：原始 Socket.IO 版本/Engine.IO 兼容性、Peer open 本地适配、创建页的 HTTP 房间列表/地址入口、客户端素材完整性。这些不由数字事件表保证。

辅助能力仍有不确定项：官方错误状态文案/断开原因、desync 请求目标选择及 `a` 标志含义、XP算法与新token签发、quick map 返回集合格式、debugWinner 细节。普通双人大厅→开局不依赖这些未知项；不能据本文声称这些官方业务已完整复现。

### 倒计时补充

倒计时由房主客户端的 `h95`（33192 行）调度：每秒 C36 `{num:3}`、`{num:2}`、`{num:1}`，归零时直接生成 C5 开局消息。服务器只转发 S43(num)，不要另起倒计时并重复触发开局。C37 转发 S44，房主自身已清除定时器。

### 负响应

此版本没有已注册的数字 joinRejected/createRejected 回调。S16 `(statusText)` 是确定存在的状态通道；Socket.IO `error` handler 为空，`connect_error` 显示 Connect error，`disconnect` 触发 disconnectedFromMona。不能把猜造的 `{error:...}` 当成现有入房错误契约。S14/S37 虽注册但不消费；S24 是踢人通知，当前上层只给房主显示 Banned/Kicked，目标本身需要真实断开。`S57(false, errorCode)` 仅用于地图策展，已见错误码：rate_limit、not_logged_in、invalid_mapid、invalid_dbv、invalid_comment、comment_too_long、unauthorised、map_private。

## HTTP 房间列表与加入地址契约

2026-10-13 复核本地原客户端：`C9/o8j`（3280–3545 行）、`h7j`（3966–4030 行）、`G_b`（4183 行）、`K7s`（21896 行）。人数、等级、距离字段的混淆索引已用本地页面真实 `B3jF8` 解码器求值，再查本地 runtime dictionary 确认；未点击页面或修改产品状态。

### POST scripts/getrooms.php

请求 form：`{version, gl, token}`。`gl` 是 `"y"` / `"n"`；本地纬度或经度为 0 时传 `"y"`。

最小有效响应示例：

```json
{
  "rooms": [{
    "id": "local-room-id",
    "roomname": "Alice's game",
    "players": 1,
    "maxplayers": 8,
    "password": 0,
    "minlevel": 0,
    "maxlevel": 999,
    "country": "CN",
    "latitude": 31.23,
    "longitude": 121.47,
    "mode_ga": "b",
    "mode_mo": "b"
  }],
  "friends": [],
  "lat": "",
  "long": "",
  "city": "",
  "country": "",
  "createserver": ""
}
```

| 字段 | 精确用途 / 限制 |
|---|---|
| `id` | 列表唯一标识、好友关联和 getroomaddress 请求参数；不能只提供 address |
| `roomname` | 第一列显示名称，`name` 不被读取 |
| `players`, `maxplayers` | 人数显示；运行时索引 121 / 1169 已确认 |
| `password` | 0/1，数值 1 显示锁并弹出口令输入；不要在列表返回密码正文 |
| `minlevel`, `maxlevel` | 等级过滤显示；索引 1170 / 1171；0..999 表示 Any level |
| `country` | 必须为字符串，直接 `.toLowerCase()` 查国旗；可以用 `"na"` |
| `latitude`, `longitude` | 房间位置，供客户端计算距离及排序；row 的 lat/long 不生效 |
| `mode_ga` | 必须是 `"b"` 或 `"f"`，否则整条房间记录跳过 |
| `mode_mo` | 必须存在于客户端模式表；普通 Classic=`"b"`；界面常规选项 b/ar/ard/sp/v/f |
| `friends` | row 可选；通常由响应外层 friends 数组按 roomid 合成 |
| `distance`, `distanceSort`, `alreadyJoined` | 由客户端计算，不要求服务器提供 |

row 的 `mode`、`mo` 不能替代 `mode_ga`/`mode_mo`；缺少后两者会出现“响应里有房间但页面没有房间行”。row 的 `address`、`server`、`version` 未在此列表渲染和选择链路消费。

响应外层 `friends` 形状是 `[{roomid: ROOM_ID, name: FRIEND_NAME}]`。外层 `lat` / `long` / `city` / `country` / `createserver` 分别更新本地全局定位和建房服务器。客户端使用 `value != ""` 判断是否更新，因此**字段省略会把 undefined 写入全局**；不更新时明确返回空字符串，或提供有效值。`createserver` 对应全局 `server`，并非房间 row 的 server。

响应不要求 `r:"success"`（此处 handler 未检查 r），但必须有 `rooms` 数组。HTTP失败显示 `Couldn't get rooms, please try again`。

### POST scripts/getroomaddress.php

房间行双击 / Join 发送 `{id: selectedRow.id}`。成功返回：

```json
{"r":"success","id":"local-room-id","address":"local-room-id","server":"local"}
```

客户端要求返回 `id` 与正在请求的 id 相等（宽松比较）。随后创建网络会话参数 `{action:"join",quick:false,address,password,roomName:"test join name",server,mo:"b"}`；这里 `address` 才会进入 C13 的 `joinID`。本地可以令 id 与 address 同值，前提是 Socket.IO 房间查询使用同一值。

非成功响应使用任意非 `success` 的 r 并带 e，例如 `{"r":"error","e":"Room no longer exists"}`，界面显示 `Error: ` 加 e。HTTP失败显示 `Address fetch failed`。

## Quick Classic 地图池

精确消费实现为 `t$e[48] = class x2g` 的 `addMaps` / `getMap`（16320–16401 行）。S2 第三个位置参数、S3 第八个位置参数与 S51 的单参数使用同一对象：

```js
{
  size: 97,
  maps: [
    {id: 0, s: "ENCODED_MAP", v: 1},
    {id: 1, s: "ENCODED_MAP", v: 1}
    // ... id 96
  ]
}
```

`id` 是循环池中从 0 开始的**槽位**，不是地图数据库ID。`v===1` 调用 `Y.fromOldString(s)`；否则调用 `Y.decodeFromDatabase(s)`。`size` 是完整循环池长度，不是本批数组长度；只返回一批也必须使用整个池的 size。

客户端存入 `mapList[id]`，`getMap(round)` 取 `mapList[round % size]`。它额外检查未来 10 张；首次遇到缺失槽位且已预载数量 <=3，会发送 C42 `{sf:firstMissingSlot}`。S51 接收同样 shape 并填充。一次发送完整小池可省去增量逻辑，C42 出现时也可直接回复完整池。

地图解码失败或没有 `spawns` 中 `f` 为真值的自由出生点时，客户端静默替换为 backupMap，因此仅“不崩溃”不能证明实际池有效。

本任务已生成 `public/local-maps.json`，内容就是可直接发给客户端的上述 payload：97 张客户端内置 community 地图，117085 字节，v=1 原始编码不变。用独立 `new context[48](fakeNetwork)` 实例执行真实 `addMaps`，逐张执行 `getMap(0..96)` 并断言有自由出生点、未使用 backupMap、未请求追加地图；97/97 成功、0 fallback。前五张标题为 A E S T H E T I C   WAVES、Altum、Antarctica、Apocalypse、The Architect。

该池保留原始地图内嵌标题与作者。`fromOldString` 转换后默认 `m.dbid=-1`、`m.dbv=2`；未把外层历史官方数据库ID注入地图，也未迁移官方地图数据库、收藏和投票。对本地 Quick Classic 轮转不构成障碍。完整池的读取和转发无需调用新的编码器或依赖当前浏览器。

客户端同时内置 33 张 arrowMapStrings 与 159 张 grappleMapStrings；其他 quick 模式通过 `context[95].getOrderedRandomMap(round,mode)` 消费自身内置列表，不需要为这次 Quick Classic 池混入这些专用地图。训练图列表在本次读取时为空，不纳入静态池。


## 本地服务器独立审阅补充（2026-10-13）

### 已定位并增加回归的协议边界

- C34 换房主必须限定整数、存在的玩家槽位。字符串 `"1"` 虽能索引 players[1]，但若原样保存，会与数字 sid 的严格权限比较冲突，导致新房主失权。已新增真实 Socket.IO 回归覆盖拒绝字符串、正常转移、新房主能操作、旧房主拒绝。
- C29 balance 原客户端允许闭区间 [-100,100]，并在发送前先修改房主本地设置。服务器只允许 ±95 会造成 96..100 只有房主生效；应广播完整范围且保存 `settings.bal[sid]`。已增加边界及非法槽位回归。
- C50 已查明并非未知选项：derived 2397 的 `a1w` 先 sendNoHostSwap 再 endSession；它绑定 `hostleaveconfirmwindow_endbutton`，原始 HTML 841 行按钮正文是 **End Room**。因此房主发送 C50 后断开，需要关闭房间、断开其他玩家；普通 Ok 离开仍迁移。已新增回归，修复前实际失败于其他成员未收到 disconnect。

### 禁言、封禁、迟加入与 XP 范围

原界面的 `/mute`、`/unmute`（1796–1861 行）和玩家菜单（34242–34267 行）只修改当前客户端的 `players[id].mute`，聊天显示器跳过该玩家。它们**不调用 C8**，且不要求房主。因此此版本无法从真实调用确定 C8 的 muteType/action 字符串或数字取值；服务器猜测 chat/audio/0/1/2 不能作为已还原协议证据，也不应把仅广播 S10/S11 说成服务端禁止聊天。

登录玩家的 ban 可稳定使用本地 userID；游客 peerID 来自每次新建 Peer 实例，普通重新加入即可改变。若本地继续按 peerID 记 ban，必须说明只限制该 peer；若要保留跨重连的游客封禁，应使用本地持久游客会话标识，不应把全部 loopback 玩家按同一 IP 封禁。

目前 sid 定向转发使用当前房间的 sockets Map，未发现跨房间路由。迟加入的关键是 S3 先给新玩家完整玩家表和原 startTime，再通知现有成员 S4，房主 C40→目标 S48 原样转发快照。游戏中的观众无需服务器生成物理输入；原客户端管理员入场事件中 playersJoined=[{id,t}] 和 pc 应透明转发。房主若在新玩家快照完成前离开，仍需要实际浏览器覆盖这一竞态；单纯正常 host migration 测试不能证明等待中的新人已收到快照。

XP 的服务端只有客户端/房主消息，没有物理模拟，不能声称能独立验证“实际获胜”。C47 原始 payload 只有 mo/mid，没有唯一 roundID；仅设 >=10 秒冷却不能防止同一轮重放。一个明确的本地规则可基于 `(matchGeneration,roundIndex,userID)` 去重，为房主报告完成且符合最短时长的轮次奖励 10XP；quick C43 已带 rc，custom 若按轮发奖则需要本地适配器给 C47 补 rc/frame，或者明确降为每次 C5 开局最多一次的对局奖励。不要把 C38 任意请求直接当成可无限发奖的证据。

原客户端 `I9l(true)`（2500 行附近）将 XP 动画文案硬编码为 `+100xp`，无论 S46 的实际增量是多少。选择本地 10XP 时应同步调整本地显示为真实增量，否则业务数据与可见反馈矛盾。历史内嵌新闻提到过每胜 100XP，但不据此推断当前官方算法。

## Final local policy

Guest bans now use a per-tab `sessionStorage` UUID injected into C12/C13 by `local-adapter.js`; authenticated bans use user IDs. The original mute remains local. C38 awards 100 XP once per C5 start after a minimum 3 seconds, only for authenticated non-spectators; repeats cannot mint XP. This is a local winner-report rule, not authoritative result verification. C47 is retained for round bookkeeping and does not independently award XP.

PICKS/HOT also expose a converted 97-map catalog using the original browser codec. Catalog IDs are negative; map author credits are retained. Replay submissions allow these built-in IDs. The native record button was exercised after countdown and at least 5 seconds of active simulation. The resulting replay is decoded and animated in the original main-menu renderer. Local invite URLs use the current origin and an opaque room UUID; password entry remains in the joining browser and is not included in the link.

Final browser acceptance also covers all four quick-play choices (Classic, Arrows, Grapple, Simple), each with automatic creation and a second client joining the running simulation over actual P2P. The captured pretty menu had not bound the retained `H01`/`y_i` handlers; the local in-memory patch binds them to Grapple/Simple. Simple uses protocol mode `training1` (not `simplequick`) and its online count maps to `quick_simple`. The local training pool includes three retained flat/simple maps plus local `bs` publications.
