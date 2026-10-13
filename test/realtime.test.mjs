import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Server } from 'socket.io';
import client from 'socket.io-client';
import { attachRooms } from '../server/realtime.mjs';
const event = (socket, name) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Missing event ${name}`)), 2000);
  socket.once(String(name), (...args) => { clearTimeout(timeout); resolve(args); });
});
test('legacy client: clock, create/join, host initial data, input, permissions and host migration', async t => {
  const httpServer = http.createServer();
  const io = new Server(httpServer, { allowEIO3: true });
  const service = attachRooms(io, { getUser: () => null });
  await new Promise(r => httpServer.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${httpServer.address().port}`;
  const a = client(url, { forceNew: true }); const b = client(url, { forceNew: true });
  t.after(() => { a.close(); b.close(); io.close(); });
  await Promise.all([event(a, 'connect'), event(b, 'connect')]);
  const clock = event(a, 23); let acknowledged = false;
  a.emit(18, { id: 'clock', jsonrpc: '2.0', method: 'timesync' }, () => { acknowledged = true; });
  assert.equal((await clock)[0].id, 'clock'); await new Promise(r => setTimeout(r, 10)); assert(acknowledged);
  const avatar = { data: { bc: 123, layers: [] } };
  const profile = name => ({ version: 49, guest: true, guestName: name, peerID: `peer-${name}`, avatar });
  const created = event(a, 2); a.emit(12, { ...profile('Alice'), roomName: 'Test', maxPlayers: 8, password: 'pw' });
  assert.equal((await created)[1], 1);
  const room = [...service.rooms.values()][0]; assert.equal(room.players[0].userName, 'Alice');
  const rejection = event(b, 16); b.emit(13, { ...profile('Bob'), joinID: room.address, roomPassword: 'wrong' });
  assert.match((await rejection)[0], /password/i); assert.equal(room.players.length, 1);
  const joined = event(b, 3); const newcomer = event(a, 4);
  b.emit(13, { ...profile('Bob'), joinID: room.address, roomPassword: 'pw' });
  assert.equal((await joined)[0], 1); assert.equal((await newcomer)[2], 'Bob');
  const initial = event(b, 21); const settings = { map: { v: 15 }, ga: 'b', mo: 'b', tl: false };
  a.emit(11, { sid: 1, gs: settings }); assert.deepEqual((await initial)[0], settings);
  const denied = event(b, 16); b.emit(5, { is: 'state', gs: { map: 'map' } }); assert.match((await denied)[0], /host/i); assert.equal(room.startTime, 0);
  const startA = event(a, 15); const startB = event(b, 15);
  a.emit(5, { is: 'encoded-state', gs: { ...settings, map: 'encoded-map' } });
  assert.deepEqual(await startA, await startB);
  const input = event(b, 7); a.emit(4, { i: 18, f: 0, c: 0 }); assert.deepEqual(await input, [0, { i: 18, f: 0, c: 0 }]);
  const chat = event(b, 20); a.emit(10, { message: 'hello' }); assert.deepEqual(await chat, [0, 'hello']);
  const snapshot = event(b, 48); a.emit(40, { sid: 1, allData: { state: 'state', fc: 5 } }); assert.equal((await snapshot)[0].fc, 5);
  const migrated = event(b, 6); a.close(); assert.equal((await migrated)[1], 1); assert.equal(room.host, 1);
});

async function twoPlayerRoom(t) {
  const server = http.createServer();
  const io = new Server(server, { allowEIO3: true });
  const service = attachRooms(io, { getUser: () => null });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const a = client(url, { forceNew: true });
  const b = client(url, { forceNew: true });
  t.after(() => { a.close(); b.close(); io.close(); });
  await Promise.all([event(a, 'connect'), event(b, 'connect')]);
  const profile = name => ({ version: 49, guest: true, guestName: name, guestID: `tab-${name}`, peerID: `peer-${name}`, avatar: { data: { bc: 123, layers: [] } } });
  const created = event(a, 2);
  a.emit(12, { ...profile('Alice'), roomName: 'Regression', maxPlayers: 8 });
  await created;
  const room = [...service.rooms.values()][0];
  const joined = event(b, 3);
  b.emit(13, { ...profile('Bob'), joinID: room.address });
  await joined;
  return { a, b, room, service, url, profile };
}

test('host transfer rejects non-integer IDs and keeps the new host authorized', async t => {
  const { a, b, room } = await twoPlayerRoom(t);
  a.emit(34, { id: '1' });
  const barrier = event(a, 1); a.emit(2); await barrier;
  assert.equal(room.host, 0, 'a string ID must not replace the numeric host ID');
  const transferred = event(b, 41); a.emit(34, { id: 1 });
  assert.deepEqual((await transferred)[0], { oldHost: 0, newHost: 1 });
  const renamed = event(a, 58); b.emit(52, { newName: 'Bob hosts' });
  assert.equal((await renamed)[0], 'Bob hosts');
  const denied = event(a, 16); a.emit(52, { newName: 'Old host mutation' });
  assert.match((await denied)[0], /host/i);
  assert.equal(room.name, 'Bob hosts');
});

test('balance accepts both UI endpoints and retains state for later members', async t => {
  const { a, b, room } = await twoPlayerRoom(t);
  for (const bal of [-100, 100, 0]) {
    const changed = event(b, 36); a.emit(29, { sid: 1, bal });
    assert.deepEqual(await changed, [1, bal]);
    assert.equal(room.settings.bal[1], bal);
  }
  a.emit(29, { sid: '__proto__', bal: 10 });
  a.emit(29, { sid: 1, bal: 101 });
  const barrier = event(a, 1); a.emit(2); await barrier;
  assert.equal(room.settings.bal[1], 0);
  assert.equal(Object.getPrototypeOf(room.settings.bal), Array.prototype);
});

test('End Room prevents host migration and disconnects remaining members', async t => {
  const { a, b, room, service } = await twoPlayerRoom(t);
  let migrated = false;
  b.on('6', () => { migrated = true; });
  a.emit(50);
  const barrier = event(a, 1); a.emit(2); await barrier;
  const closed = event(b, 'disconnect'); a.close(); await closed;
  assert.equal(migrated, false);
  assert.equal(service.rooms.has(room.id), false);
});

test('local victory XP is awarded once per started match and never to spectators', async t => {
  const httpServer = http.createServer(), io = new Server(httpServer, { allowEIO3: true });
  let xp = 0, awards = 0;
  const service = attachRooms(io, { getUser: token => token === 'synthetic-session' ? { id: 1, name: 'Alice', level: 1 } : null, recordExperience: (id, delta) => { xp += delta; awards++; return { xp, level: 2 }; } });
  await new Promise(r => httpServer.listen(0, '127.0.0.1', r));
  const a = client(`http://127.0.0.1:${httpServer.address().port}`, { forceNew: true });
  t.after(() => { a.close(); io.close(); }); await event(a, 'connect');
  const created = event(a, 2); a.emit(12, { version: 49, guest: false, token: 'synthetic-session', peerID: 'peer-a', avatar: { data: { bc: 123, layers: [] } }, roomName: 'XP test', maxPlayers: 8, password: '' }); await created;
  const room = [...service.rooms.values()][0];
  a.emit(38); await new Promise(r => setTimeout(r, 20)); assert.equal(awards, 0);
  const started = event(a, 15); a.emit(5, { is: 'state', gs: { map: 'map' } }); await started;
  room.startTime = Date.now() - 4000;
  const gained = event(a, 46); a.emit(38); assert.equal((await gained)[0].newXP, 100);
  a.emit(38); a.emit(38); await new Promise(r => setTimeout(r, 20)); assert.equal(awards, 1);
  room.players[0].rewardedStart = 0; room.players[0].team = 0;
  a.emit(38); await new Promise(r => setTimeout(r, 20)); assert.equal(awards, 1);
});

test('guest bans survive normal peer reconnects within the same tab identity', async t => {
  const h = await twoPlayerRoom(t), room = h.room;
  const bobProfile = h.profile('Bob');
  const disconnected = event(h.b, 'disconnect'); h.a.emit(9, { banshortid: 1, kickonly: false }); await disconnected;
  const c = client(h.url, { forceNew: true }); t.after(() => c.close()); await event(c, 'connect');
  const denied = event(c, 16); c.emit(13, { ...bobProfile, peerID: 'new-peer-after-reconnect', joinID: room.address, roomPassword: '' });
  assert.match((await denied)[0], /banned/i); assert.equal(room.players.filter(Boolean).length, 1);
});
