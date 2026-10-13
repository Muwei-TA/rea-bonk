# Local PHP-path API compatibility

This is a local reimplementation inferred from the captured client, not the original server source. No official account, write API, or community database is used. Evidence stays unchanged in `artifacts/derived/game.readable.js` and `artifacts/evidence/endpoints.json`.

`createApi({dataDir,getRooms,getRoomAddress,matchmaking,getOnlineCount,getRoomForUser,builtinMaps})` creates `dataDir/local-bonk.sqlite`. Node 24's built-in SQLite and crypto are the only dependencies. `handle(pathname,body,req,res)` consumes a parsed form object and returns whether it handled the path. `/scripts/` and `/api/` use the same suffixes. Call `close()` before moving a live database; SQLite WAL sidecars are part of a live backup.

All `.php` requests use POST and JSON responses. Application failures use `{r:"fail",e:"reason"}` with HTTP 200 because the captured client processes these in jQuery `.done`; invalid methods/bodies are 405/400 and unexpected server failures are 500. `.txt` responses are plain text containing JSON because the client explicitly calls `JSON.parse`.

| Endpoint | Request fields | Success response / behavior | Client evidence lines |
| --- | --- | --- | --- |
| `register_legacy.php` | `username,password,remember` | Account object; username 3–25 ASCII letters/digits/underscore, password 8–1024 bytes | 20411 |
| `login_legacy.php` | same | Account object, password verification required | 20724 |
| `login_auto.php` | `rememberToken` | Account object and new session token | 21597 |
| `login_clearauto.php` | `rememberToken` | Revoke that remember token | 23943 |
| `account_changepassword.php` | `token,oldpass,newpass` | Verify old password, change hash, revoke other session and remember tokens | 20865 |
| `account_savecontrols.php` | `token,controls` | Persist bounded base64 controls string | 22397 |
| `avatar_update.php` | `token,task:updateslot,newactive` or `task:updateavatar,newavatarslot,newavatar` | Persist 1-based active slot / one of 5 encoded avatar strings | 32705, 32847 |
| `friends.php` | `token,task`, `theirname` for send, `theirid` otherwise | `getfriends`: `{r,friends:[{id,name,roomid:onlineRoomIdOrNull}],requests:[{id,name}]}`. `send`: `send_success` or reciprocal `accept_success`; accept/deleterequest/unfriend: success | 20960, 21967, 22346, 23118, 23876, 24087 |
| `map_save_pub.php` | `token,mapname,leveldata,overwriteok,public,mo,rxid,rxdb,rxn,rxa` | `{r:success,mapid}`; same owner/name returns `{r:overwrite_confirm}` until explicit overwrite | 37355, 37393 |
| `map_getsearch.php` | `searchauthor,searchmapname,searchsort,searchstring,startingfrom` | Public maps, name/author substring search, newest or net vote order | 30941 |
| `map_getfresh.php` | `startingfrom` | Public maps newest first | 30965 |
| `map_getown.php` | `token,startingfrom` | Only authenticated owner's maps, including private maps | 31124 |
| `map_getfave.php` | `token,startingfrom` | That user's public favourites | 30985 |
| `map_delete.php` | `token,mapid` | Delete owned map; cascade favourites/votes | 31665 |
| `map_fave.php` | `token,mapid,action:f/u` | Favourite/upvote or unfavourite; no duplicate votes | 1404, 2902, 32303 |
| `map_vote.php` (local bridge) | `token,mapid,vote` | 1 up, 0 down; same implementation as realtime `voteMap` | Realtime client 15948, 33293, 33870 |
| `replay_submit.php` | `version,replaydata,mapid,mode?` | `{r:success,id}`, anonymous as in original request contract; negative built-in map IDs accepted | 44547, 44627 |
| `replay_get.php` | `version,offset,startingFrom?,mode?` | `{r:success,replays:[{id,replaydata}]}`, newest first, 10/page | 9349 |
| `replay_report.php` | `replayid` | Persist one report per replay/local IP hash; does not remove or hide replay | 9607 |
| `matchmaking_maps.php` | none | `{r:success,t1:[map...]}`, locally published simple-mode (`bs`) maps plus the retained Classic, Balance and Altum maps for the local initial pool | 46339 |
| `hotmaps/*.txt` | none | Local public maps ranked by upvotes plus 97 retained client maps; original authors remain credited, no official live editorial feed | 310xx |
| `combinedplayercount.txt` | GET | `{bonk:{total,classic,custom,quick_classic,quick_arrows,quick_simple,quick_grapple},car:{total}}` | 24040, runtime dictionary |

Account objects contain `r,token,rememberToken,id,username,userName,name,guest:false,xp,level,avatar,avatar1..5,activeAvatarNumber,controls,friends,legacyFriends`. `activeAvatarNumber` is 1-based in the HTTP response; the captured client subtracts one. Empty avatar/controls strings invoke the client's defaults. Map list responses are `{r:success,maps:[{id,name,authorname,leveldata,publisheddate,mo,public,vu,vd}],more}`; own pages contain 30 maps, other pages 32. Both `creationdate` and `publisheddate` are returned for the original own-map and public-map views. The editor sends `mo:""` for Any mode; this is accepted. Publication dates use `YYYY-MM-DD HH:mm:ss` in UTC. Map/replay strings are bounded opaque client encodings; the API preserves bytes and does not claim to validate their game physics or codec semantics.

Room callbacks are supplied by the realtime server: `getRooms(body,req)` may return a full response or an array (wrapped with empty location fields); `getRoomAddress(body.id,body,req)` returns the response; `matchmaking(body,req)` returns the response. `getOnlineCount()` can return a complete count object or a number. The numeric fallback assigns total/classic/custom to that number and quick modes to zero; use the object form for accurate per-mode counts.

`getUser(token)` returns `{id,name,userName,guest:false,xp,level,avatar,controls}` or null; `avatar` is the stored encoded string. `recordExperience(userId,xp)` accepts a nonnegative integer delta, clamps total XP to one billion, and returns `{xp,level}`. `voteMap(userId,mapId,vote)` is intended for a server-authenticated realtime identity, never an untrusted client-supplied user ID.

Passwords use a per-account random salt and scrypt. Random session and remember tokens are SHA-256 hashed in SQLite; sessions expire after 7 days and remember tokens after 365 days. Authentication is throttled to 30 attempts/minute/local source IP. Map writes require a session, author names come from the authenticated account, and deletion/overwrite enforce ownership. No CORS permission is added. HTTP binding/origin policy belongs to the main server. Friend room presence is supplied live by `getRoomForUser` and disclosed only to accepted friends. Friendship relationships themselves are persisted. In-flight password checks revalidate the session and stored password after scrypt before issuing or changing credentials.

Bonk 1 migration and unknown/verification endpoints explicitly return `unsupported`. There are no seeded success credentials, synthetic official maps, automatic report removals, or calls to remote services. Empty local collections are reported as empty. This API is for the local reproduction, without production-scale anonymous replay quotas or account recovery/email delivery.

Run `node --test test/api.test.mjs`. The tests use temporary databases and synthetic accounts through actual local HTTP requests, covering authentication failure/success, map visibility/ownership/overwrite/delete, restart persistence, friendship authorization, settings/password revocation, unique voting, replay filtering/report retention and unsupported operations. Opaque codec fixtures test storage integrity, not browser rendering; the main application must separately verify real client-generated maps, avatars and replays.

Local timestamps are parsed in UTC through the in-memory client patch, overriding the original New York default. XP levels follow `floor(sqrt(xp)/10)+1`, checked against the captured runtime. The realtime layer defines the separate local victory award rule. Built-in catalog IDs are negative and not writable map records; local user maps have positive SQLite IDs.
