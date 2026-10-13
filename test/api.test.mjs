import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createApi } from '../server/api.mjs';

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'bonk-api-test-'));
  let api = createApi({ dataDir, getOnlineCount: () => 3, ...options });
  const server = createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk;
    if (!await api.handle(new URL(req.url, 'http://local').pathname, Object.fromEntries(new URLSearchParams(data)), req, res)) { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); api.close(); await rm(dataDir, { recursive: true, force: true }); });
  const post = async (path, body = {}) => (await fetch(`${base}/scripts/${path}`, { method: 'POST', body: new URLSearchParams(body) })).json();
  return { post, base, dataDir, get api() { return api; }, restart() { api.close(); api = createApi({ dataDir, ...options }); },
    register: (username, remember = true) => post('register_legacy.php', { username, password: 'Synthetic-password-42', remember }) };
}

test('registration, login, private/public maps, ownership and restart persistence', async t => {
  const f = await fixture(t);
  const alice = await f.register('SyntheticAlice'); const bob = await f.register('SyntheticBob');
  assert.equal(alice.r, 'success'); assert.equal(alice.activeAvatarNumber, 1);
  assert.equal((await f.register('syntheticalice')).e, 'username_taken');
  assert.equal((await f.post('login_legacy.php', { username: alice.username, password: 'wrong' })).e, 'password');
  const login = await f.post('login_legacy.php', { username: 'syntheticalice', password: 'Synthetic-password-42' });
  assert.equal(login.id, alice.id); assert.equal(f.api.getUser(login.token).guest, false);
  assert.equal(f.api.getUser('forged'), null);
  assert.equal((await f.post('map_save_pub.php', { token: 'forged' })).e, 'token');
  const map = { token: alice.token, mapname: 'Synthetic arena', leveldata: 'opaque-original-client-codec-fixture', public: 1, mo: '' };
  const saved = await f.post('map_save_pub.php', map); assert.equal(saved.r, 'success');
  assert.equal((await f.post('map_save_pub.php', map)).r, 'overwrite_confirm');
  assert.equal((await f.post('map_save_pub.php', { ...map, overwriteok: true, leveldata: 'replacement' })).mapid, saved.mapid);
  const privateMap = await f.post('map_save_pub.php', { ...map, mapname: 'Private fixture', public: 0 });
  const search = await f.post('map_getsearch.php', { searchstring: 'arena', searchmapname: true, searchsort: 'best' });
  assert.equal(search.maps.length, 1); assert.equal(search.maps[0].authorname, alice.username);
  assert.equal(search.maps[0].leveldata, 'replacement'); assert.equal(search.more, false);
  assert.equal(search.maps[0].mo, '', 'The editor uses an empty mode string for Any');
  assert.equal(search.maps[0].creationdate, search.maps[0].publisheddate);
  assert.equal((await f.post('map_getfresh.php')).maps.length, 1);
  assert.equal((await f.post('map_getown.php', { token: alice.token })).maps.length, 2);
  assert.equal((await f.post('map_getown.php', { token: bob.token })).maps.length, 0);
  assert.equal((await f.post('map_delete.php', { token: bob.token, mapid: saved.mapid })).e, 'forbidden');
  assert.equal((await f.post('map_fave.php', { token: bob.token, mapid: privateMap.mapid, action: 'f' })).e, 'map_unpublished');
  f.restart();
  assert.equal(f.api.getUser(alice.token).id, alice.id);
  assert.equal((await f.post('login_auto.php', { rememberToken: alice.rememberToken })).id, alice.id);
  assert.equal((await f.post('map_getown.php', { token: alice.token })).maps.length, 2);
  assert.equal((await f.post('map_delete.php', { token: alice.token, mapid: saved.mapid })).r, 'success');
  assert.equal((await f.post('map_getfresh.php')).maps.length, 0);
  const db = new DatabaseSync(join(f.dataDir, 'local-bonk.sqlite'), { readOnly: true });
  assert.notEqual(db.prepare('SELECT password FROM users WHERE id=?').get(alice.id).password, 'Synthetic-password-42');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tokens WHERE hash=?').get(alice.token).n, 0);
  db.close();
});

test('friends enforce recipient acceptance and maintain symmetric membership', async t => {
  const f = await fixture(t); const a = await f.register('FriendAlice'); const b = await f.register('FriendBob'); const c = await f.register('FriendCarol');
  const action = (token, task, extra = {}) => f.post('friends.php', { token, task, ...extra });
  assert.equal((await action(a.token, 'send', { theirname: a.username })).e, 'cant_friend_self');
  assert.equal((await action(a.token, 'send', { theirname: b.username })).r, 'send_success');
  assert.equal((await action(a.token, 'accept', { theirid: b.id })).e, 'request_not_found');
  assert.equal((await action(c.token, 'accept', { theirid: a.id })).e, 'request_not_found');
  assert.deepEqual((await action(b.token, 'getfriends')).requests, [{ id: a.id, name: a.username }]);
  assert.equal((await action(b.token, 'accept', { theirid: a.id })).r, 'success');
  assert.equal((await action(a.token, 'getfriends')).friends[0].id, b.id);
  assert.equal((await action(b.token, 'getfriends')).friends[0].id, a.id);
  assert.equal((await action(b.token, 'unfriend', { theirid: a.id })).r, 'success');
  assert.equal((await action(a.token, 'getfriends')).friends.length, 0);
  await action(a.token, 'send', { theirname: b.username });
  assert.equal((await action(b.token, 'send', { theirname: a.username })).r, 'accept_success');
  await action(c.token, 'send', { theirname: a.username });
  assert.equal((await action(a.token, 'deleterequest', { theirid: c.id })).r, 'success');
  assert.equal((await action(a.token, 'getfriends')).requests.length, 0);
});

test('friend presence is resolved live and only disclosed to accepted friends', async t => {
  const presence = new Map();
  const f = await fixture(t, { getRoomForUser: id => presence.get(id), getRooms: () => ({ r: 'success', rooms: [], friends: [{ id: 999 }] }) });
  const alice = await f.register('PresentAlice'); const bob = await f.register('PresentBob'); const carol = await f.register('PresentCarol');
  await f.post('friends.php', { token: alice.token, task: 'send', theirname: bob.username });
  presence.set(bob.id, 42);
  assert.deepEqual((await f.post('getrooms.php', { token: alice.token })).friends, []);
  await f.post('friends.php', { token: bob.token, task: 'accept', theirid: alice.id });
  assert.deepEqual((await f.post('friends.php', { token: alice.token, task: 'getfriends' })).friends, [{ id: bob.id, name: bob.username, roomid: 42 }]);
  assert.equal((await f.post('getrooms.php', { token: alice.token })).friends[0].roomid, 42);
  assert.deepEqual((await f.post('getrooms.php', { token: carol.token })).friends, []);
  assert.deepEqual((await f.post('getrooms.php')).friends, []);
  presence.delete(bob.id);
  assert.equal((await f.post('friends.php', { token: alice.token, task: 'getfriends' })).friends[0].roomid, null);
  assert.deepEqual((await f.post('getrooms.php', { token: alice.token })).friends, []);
});

test('avatar, controls, XP and password changes persist and revoke other tokens', async t => {
  const f = await fixture(t); const a = await f.register('SettingsAlice');
  const second = await f.post('login_auto.php', { rememberToken: a.rememberToken });
  assert.equal((await f.post('avatar_update.php', { token: a.token, task: 'updateslot', newactive: 6 })).e, 'data_invalid');
  await f.post('avatar_update.php', { token: a.token, task: 'updateavatar', newavatarslot: 2, newavatar: 'opaque-avatar-fixture' });
  await f.post('avatar_update.php', { token: a.token, task: 'updateslot', newactive: 2 });
  await f.post('account_savecontrols.php', { token: a.token, controls: 'AAE=' });
  assert.deepEqual(f.api.recordExperience(a.id, 100), { xp: 100, level: 2 });
  assert.deepEqual(f.api.recordExperience(a.id, 0), { xp: 100, level: 2 });
  assert.equal(f.api.recordExperience(a.id, -1), null);
  f.restart();
  const remembered = await f.post('login_auto.php', { rememberToken: a.rememberToken });
  assert.equal(remembered.avatar2, 'opaque-avatar-fixture'); assert.equal(remembered.avatar, remembered.avatar2);
  assert.equal(remembered.controls, 'AAE='); assert.equal(remembered.activeAvatarNumber, 2);
  assert.equal((await f.post('account_changepassword.php', { token: a.token, oldpass: 'bad', newpass: 'Synthetic-new-password' })).e, 'oldpass_wrong');
  assert.equal((await f.post('account_changepassword.php', { token: a.token, oldpass: 'Synthetic-password-42', newpass: 'Synthetic-new-password' })).r, 'success');
  assert.equal(f.api.getUser(second.token), null); assert.ok(f.api.getUser(a.token));
  assert.equal((await f.post('login_auto.php', { rememberToken: a.rememberToken })).e, 'token');
  assert.equal((await f.post('login_legacy.php', { username: a.username, password: 'Synthetic-password-42' })).e, 'password');
  const fresh = await f.post('login_legacy.php', { username: a.username, password: 'Synthetic-new-password', remember: true });
  assert.equal(fresh.r, 'success');
  await f.post('login_clearauto.php', { rememberToken: fresh.rememberToken });
  assert.equal((await f.post('login_auto.php', { rememberToken: fresh.rememberToken })).e, 'token');
});

test('favourites and votes are idempotent; replay reports do not delete content', async t => {
  const f = await fixture(t); const a = await f.register('VoteAlice');
  const map = await f.post('map_save_pub.php', { token: a.token, mapname: 'Vote fixture', leveldata: 'opaque', public: 1, mo: 'bs' });
  for (let i = 0; i < 2; i++) await f.post('map_fave.php', { token: a.token, mapid: map.mapid, action: 'f' });
  assert.equal((await f.post('map_getfave.php', { token: a.token })).maps[0].vu, 1);
  assert.equal(f.api.voteMap(a.id, map.mapid, 0).r, 'success');
  const row = (await f.post('map_getfresh.php')).maps[0]; assert.equal(row.vu, 0); assert.equal(row.vd, 1);
  assert.equal((await f.post('matchmaking_maps.php')).t1[0].id, map.mapid);
  await f.post('map_fave.php', { token: a.token, mapid: map.mapid, action: 'u' });
  assert.equal((await f.post('map_getfave.php', { token: a.token })).maps.length, 0);
  const replay = await f.post('replay_submit.php', { version: 48, replaydata: 'encoded-replay-fixture', mapid: map.mapid, mode: 'bs' });
  assert.equal(replay.r, 'success');
  await f.post('replay_report.php', { replayid: replay.id });
  assert.deepEqual((await f.post('replay_get.php', { version: 48, mode: 'bs' })).replays, [{ id: replay.id, replaydata: 'encoded-replay-fixture' }]);
  assert.equal((await f.post('replay_get.php', { version: 49 })).replays.length, 0);
  f.restart(); assert.equal((await f.post('replay_get.php', { version: 48 })).replays.length, 1);
  assert.equal((await f.post('replay_submit.php', { version: 49, replaydata: 'builtin-map-replay-fixture', mapid: -18 })).r, 'success');
  assert.equal((await f.post('replay_submit.php', { version: 49, replaydata: 'bad-mapid', mapid: 'x' })).e, 'data_invalid');
});

test('unsupported operations and malformed input fail explicitly; counts are plain text JSON', async t => {
  const builtin = { id: -1, name: 'Retained map', authorname: 'Original author', leveldata: 'encoded-map' };
  const f = await fixture(t, { builtinMaps: [builtin] });
  assert.deepEqual((await f.post('hotmaps/picks.txt')).maps, [builtin]);
  assert.equal((await f.post('map_b1_getown.php')).e, 'unsupported');
  assert.equal((await f.post('captcha.php')).e, 'unsupported');
  assert.equal((await f.post('map_getfresh.php', { startingfrom: "0 OR 1=1" })).e, 'data_invalid');
  const response = await fetch(`${f.base}/scripts/combinedplayercount.txt`);
  assert.match(response.headers.get('content-type'), /^text\/plain/);
  assert.equal(JSON.parse(await response.text()).bonk.total, 3);
  assert.equal((await fetch(`${f.base}/scripts/map_delete.php`)).status, 405);
});

test('in-flight authentication cannot issue a session from a replaced password or revoked token', async t => {
  const f = await fixture(t); const alice = await f.register('ConcurrentAlice');
  const other = await f.post('register_legacy.php', { username: 'ConcurrentBob', password: 'Another-synthetic-password' });
  const db = new DatabaseSync(join(f.dataDir, 'local-bonk.sqlite'));
  t.after(() => db.close());
  const direct = (path, body) => {
    let answer;
    const done = f.api.handle(`/scripts/${path}`, body, { method: 'POST', socket: { remoteAddress: 'fixture' } }, { setHeader() {}, end(data) { answer = JSON.parse(data); } });
    return done.then(() => answer);
  };
  // scrypt yields; replace credentials before verification can issue a new token.
  const pendingLogin = direct('login_legacy.php', { username: alice.username, password: 'Synthetic-password-42' });
  db.prepare('UPDATE users SET password=(SELECT password FROM users WHERE id=?) WHERE id=?').run(other.id, alice.id);
  assert.equal((await pendingLogin).e, 'password');
  const pendingChange = direct('account_changepassword.php', { token: alice.token, oldpass: 'Another-synthetic-password', newpass: 'Do-not-apply-this-password' });
  db.prepare('DELETE FROM tokens WHERE user_id=?').run(alice.id);
  assert.equal((await pendingChange).e, 'token');
  assert.equal((await f.post('login_legacy.php', { username: alice.username, password: 'Another-synthetic-password' })).r, 'success');
});

test('XP levels match observed original-client runtime thresholds', async t => {
  const f = await fixture(t); const a = await f.register('ThresholdAlice');
  // Values observed by calling the captured client's xpToLevel in the local browser.
  let previous = 0;
  for (const [xp, expected] of [[0, 1], [99, 1], [100, 2], [399, 2], [400, 3], [900, 4], [10000, 11]]) {
    assert.deepEqual(f.api.recordExperience(a.id, xp - previous), { xp, level: expected });
    previous = xp;
  }
});
