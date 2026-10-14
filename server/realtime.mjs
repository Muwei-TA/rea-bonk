import { randomUUID } from 'node:crypto';

const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const text = (s, max) => typeof s === 'string' && s.length <= max;
const bounded = (o, max = 2_000_000) => o !== undefined && JSON.stringify(o).length <= max;

export function attachRooms(io, api, { quickMaps = () => [] } = {}) {
  const rooms = new Map();
  let nextID = 1;
  const count = r => r.players.filter(Boolean).length;
  const frame = r => r.startTime ? Math.max(0, Math.floor((Date.now() - r.startTime) * 30 / 1000)) : 0;
  const send = (s, event, ...args) => s.emit(String(event), ...args);
  const broadcast = (r, event, ...args) => r.sockets.forEach(s => send(s, event, ...args));
  const others = (r, socket, event, ...args) => r.sockets.forEach(s => { if (s !== socket) send(s, event, ...args); });
  const status = (socket, message) => send(socket, 16, message);
  const player = d => {
    const user = d.guest === true ? null : api.getUser(d.token);
    if (d.guest !== true && !user) throw new Error('Please log in again.');
    const name = user?.userName ?? user?.name ?? d.guestName;
    if (!text(name, user ? 25 : 120) || !name.trim() || [...name].length > 60 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Invalid player name.');
    if (!text(d.peerID ?? '', 128) || !text(d.guestID ?? '', 128) || !bounded(d.avatar, 64_000)) throw new Error('Invalid player profile.');
    return { peerID: d.peerID || '', guestID: d.guestID || d.peerID || '', userName: name.trim(), guest: !user, userID: user?.id ?? null,
      level: user?.level ?? 1, team: 1, ready: false, tabbed: false, avatar: d.avatar, ping: 0 };
  };
  io.on('connection', socket => {
    let room, sid;
    let messageWindow = Date.now(), messages = 0, sequence = -1;
    const on = (event, fn, hostOnly = false) => socket.on(String(event), d => {
      try {
        if (!room || !room.players[sid]) return;
        if (hostOnly && room.host !== sid) return status(socket, 'Only the host can do that.');
        if (!bounded(d ?? null)) return status(socket, 'Message too large.');
        fn(d ?? {});
      } catch { status(socket, 'Invalid request.'); }
    });
    socket.on('18', (rpc, ack) => {
      if (!rpc || !['string', 'number'].includes(typeof rpc.id)) return;
      if (typeof ack === 'function') ack();
      send(socket, 23, { jsonrpc: '2.0', id: rpc.id, result: Date.now() });
    });
    socket.on('12', d => {
      try {
        if (room || !d || d.version !== 49 || !text(d.roomName, 64) || !text(d.password ?? '', 64)) throw new Error('Invalid room settings.');
        const p = player(d);
        const maxPlayers = Number(d.maxPlayers);
        if (!integer(maxPlayers, 1, 8)) throw new Error('Invalid player limit.');
        room = { id: nextID++, address: randomUUID(), name: d.roomName.trim() || 'Bonk room', password: d.password || '', maxPlayers,
          hidden: Boolean(d.hidden), quick: Boolean(d.quick), mode: d.mode || 'custom', minLevel: Number(d.minLevel) || 0,
          maxLevel: Number(d.maxLevel) || 999, host: 0, players: [p], sockets: new Map([[0, socket]]), startTime: 0,
          settings: {}, banned: new Set(), token: randomUUID() };
        rooms.set(room.id, room); sid = 0;
        send(socket, 2, room.id, 1, room.quick ? quickMaps(room.mode) : null);
        send(socket, 49, room.address, '');
      } catch (e) { status(socket, e.message); }
    });
    socket.on('13', d => {
      try {
        if (room || !d || d.version !== 49) throw new Error('Invalid join request.');
        const target = [...rooms.values()].find(r => r.address === d.joinID || String(r.id) === String(d.joinID));
        if (!target) throw new Error('Room no longer exists.');
        if (target.password !== (d.roomPassword || '')) throw new Error('Incorrect room password.');
        if (count(target) >= target.maxPlayers) throw new Error('Room is full.');
        const p = player(d);
        if (target.banned.has(p.userID ?? p.guestID)) throw new Error('You are banned from this room.');
        if (p.level < target.minLevel || p.level > target.maxLevel) throw new Error('Level outside room limits.');
        room = target; sid = room.players.findIndex(p => p === null);
        if (sid < 0) sid = room.players.length;
        room.players[sid] = p; room.sockets.set(sid, socket);
        send(socket, 3, sid, room.host, room.players, room.startTime, null, room.address, '', room.quick ? quickMaps(room.mode) : null);
        others(room, socket, 4, sid, p.peerID, p.userName, p.guest, p.level, p.team, p.avatar);
      } catch (e) { status(socket, e.message); }
    });
    on(4, d => {
      if (!room.startTime || !integer(d.i, 0, 63) || !integer(d.f, 0, 1e9) || !integer(d.c, 0, 1e9) || d.c <= sequence || d.f > frame(room) + 300) return;
      sequence = d.c; others(room, socket, 7, sid, { i: d.i, f: d.f, c: d.c });
    });
    on(5, d => {
      if (!text(d.is, 2_000_000) || !d.gs || !text(d.gs.map, 2_000_000)) return;
      room.startTime = Date.now() + 250; room.settings = d.gs;
      room.experienceAwarded = false;
      broadcast(room, 15, room.startTime, d.is, d.gs);
    }, true);
    on(11, d => { if (room.sockets.has(d.sid) && d.gs) { room.settings = d.gs; send(room.sockets.get(d.sid), 21, d.gs); } }, true);
    on(40, d => { if (room.sockets.has(d.sid) && d.allData) send(room.sockets.get(d.sid), 48, d.allData); }, true);
    on(6, d => { if ((!room.settings.tl || room.host === sid) && integer(d.targetTeam, 0, 5)) { room.players[sid].team = d.targetTeam; broadcast(room, 18, sid, d.targetTeam); } });
    on(26, d => { if (integer(d.targetID, 0, 7) && room.players[d.targetID] && integer(d.targetTeam, 0, 5)) { room.players[d.targetID].team = d.targetTeam; broadcast(room, 18, d.targetID, d.targetTeam); } }, true);
    on(7, d => { room.settings.tl = Boolean(d.teamLock); broadcast(room, 19, room.settings.tl); }, true);
    on(8, () => status(socket, 'Use the player menu to mute locally.'));
    on(9, d => {
      if (!integer(d.banshortid, 0, 7) || !room.players[d.banshortid] || d.banshortid === sid) return;
      if (!d.kickonly) { const p = room.players[d.banshortid]; room.banned.add(p.userID ?? p.guestID); }
      broadcast(room, 24, d.banshortid, Boolean(d.kickonly)); room.sockets.get(d.banshortid)?.disconnect(true);
    }, true);
    on(10, d => {
      if (!text(d.message, 1000)) return;
      if (Date.now() - messageWindow > 1000) { messageWindow = Date.now(); messages = 0; }
      if (++messages > 8) return;
      broadcast(room, 20, sid, d.message);
    });
    on(14, () => { room.startTime = 0; broadcast(room, 13); }, true);
    on(16, d => { room.players[sid].ready = Boolean(d.ready); broadcast(room, 8, sid, Boolean(d.ready)); });
    on(17, () => { room.players.forEach(p => { if (p) p.ready = false; }); broadcast(room, 9); }, true);
    on(19, d => { if (integer(d.s, 0, 1000) && integer(d.e, 0, 1000)) broadcast(room, 25, d.s, d.e); }, true);
    on(20, d => { if (['b', 'f'].includes(d.ga) && ['b', 'ar', 'ard', 'sp', 'v', 'f', 'bs'].includes(d.mo)) { Object.assign(room.settings, { ga: d.ga, mo: d.mo }); broadcast(room, 26, d.ga, d.mo); } }, true);
    on(21, d => { if (integer(d.w, 1, 100)) { room.settings.wl = d.w; broadcast(room, 27, d.w); } }, true);
    on(22, d => { if (integer(d.d, 0, 1000)) broadcast(room, 28, d.d); }, true);
    on(23, d => { if (text(d.m, 2_000_000)) { room.settings.map = d.m; broadcast(room, 29, d.m); } }, true);
    on(24, () => others(room, socket, 30, sid));
    on(25, d => { if (integer(d.f, 0, 1e9) && d.a) broadcast(room, 31, d); }, true);
    on(27, d => { if (text(d.m, 2_000_000) && text(d.mapname, 100) && text(d.mapauthor, 100)) { send(room.sockets.get(room.host), 33, d.m, sid); broadcast(room, 34, d.mapname, d.mapauthor, sid); } });
    on(28, d => { if (['b', 'ar', 'ard', 'sp', 'v', 'f', 'bs'].includes(d)) { room.settings.mo = d; broadcast(room, 35, d); } }, true);
    on(29, d => { if (integer(d.sid, 0, 7) && room.players[d.sid] && typeof d.bal === 'number' && Math.abs(d.bal) <= 100) { (room.settings.bal ??= [])[d.sid] = d.bal; broadcast(room, 36, d.sid, d.bal); } }, true);
    on(30, () => send(socket, 37, { version: 49 }));
    on(31, d => { if (room.players[d.wid]) broadcast(room, 38, d.wid, 0); }, true);
    on(32, d => { room.settings.tea = Boolean(d.t); if (!d.t) room.players.forEach(p => { if (p && p.team) p.team = 1; }); broadcast(room, 39, Boolean(d.t)); }, true);
    on(33, () => broadcast(room, 40, sid));
    on(34, d => { if (integer(d.id, 0, 7) && room.players[d.id]) { const oldHost = room.host; room.host = d.id; broadcast(room, 41, { oldHost, newHost: d.id }); } }, true);
    on(35, d => { if (room.sockets.has(d.id)) send(room.sockets.get(d.id), 42, sid); });
    on(36, d => { if (integer(d.num, 0, 10)) broadcast(room, 43, d.num); }, true);
    on(37, () => broadcast(room, 44), true);
    on(38, () => {
      const p = room.players[sid];
      // Local victory report: 100 XP once per started match; spectators cannot claim it.
      if (!p.userID || !p.team || !room.startTime || Date.now() - room.startTime < 3000 || p.rewardedStart === room.startTime) return;
      p.rewardedStart = room.startTime;
      const award = api.recordExperience(p.userID, 100);
      if (award) { send(socket, 46, { newXP: award.xp }); if (award.level > p.level) { p.level = award.level; broadcast(room, 45, { sid, lv: award.level }); } }
    });
    on(39, d => { const p = room.players[sid]; if (p.userID && integer(d.mapid, 1, 1e9) && [0, 1].includes(d.vote)) { if (api.voteMap?.(p.userID, d.mapid, d.vote)?.r === 'success') send(socket, 50, d.mapid, d.vote); } });
    on(41, d => send(socket, 50, d.mapid, -1));
    on(42, () => send(socket, 51, quickMaps(room.mode)));
    on(43, d => { if (integer(d.rc, 0, 1e9)) room.round = d.rc; }, true);
    on(44, d => { room.players[sid].tabbed = Boolean(d.out); others(room, socket, 52, sid, Boolean(d.out)); });
    on(45, d => { if (integer(d.sid, 0, 1e9)) others(room, socket, 53, sid, d.sid, Boolean(d.a)); });
    on(46, d => { if (room.sockets.has(d.rid) && integer(d.sid, 0, 1e9) && text(d.s, 2_000_000)) send(room.sockets.get(d.rid), 54, sid, d.s, d.sid); });
    on(47, () => { room.completedRounds = (room.completedRounds || 0) + 1; }, true);
    on(50, () => { room.noHostSwap = true; }, true);
    on(51, () => send(socket, 57, false, 'permission_denied'));
    on(52, d => { if (text(d.newName, 64) && d.newName.trim()) { room.name = d.newName.trim(); broadcast(room, 58, room.name); } }, true);
    on(53, d => { if (text(d.newPass, 64)) { room.password = d.newPass; broadcast(room, 59, Boolean(room.password)); } }, true);
    socket.on('2', () => { if (room) send(socket, 1, Object.fromEntries(room.players.map((p, id) => [id, p?.ping ?? 0])), Date.now()); });
    socket.on('1', d => { if (room && typeof d?.id === 'number') room.players[sid].ping = Math.min(999, Math.max(0, Date.now() - d.id)); });
    socket.on('disconnect', () => {
      if (!room || room.closing) return;
      room.sockets.delete(sid); room.players[sid] = null;
      if (room.host === sid && room.noHostSwap) { room.closing = true; rooms.delete(room.id); room.sockets.forEach(s => { send(s, 60, 'The host ended the room.'); s.disconnect(true); }); return; }
      if (!count(room)) { rooms.delete(room.id); return; }
      if (room.host === sid) { const oldHost = sid; room.host = room.players.findIndex(Boolean); broadcast(room, 6, oldHost, room.host, frame(room)); }
      else broadcast(room, 5, sid, frame(room));
    });
  });
  return {
    rooms,
    getRoomForUser(userID) { return [...rooms.values()].find(r => r.players.some(p => p?.userID === userID))?.id ?? null; },
    getRooms() { return { r: 'success', rooms: [...rooms.values()].filter(r => !r.hidden).map(r => ({ id: r.id, name: r.name, roomname: r.name,
      players: count(r), maxplayers: r.maxPlayers, password: Number(Boolean(r.password)), minlevel: r.minLevel, maxlevel: r.maxLevel,
      latitude: 0, longitude: 0, country: 'na', mode_ga: r.settings.ga || 'b', mode_mo: r.settings.mo || 'b' })), friends: [], lat: 0, long: 0, country: 'na', city: 'Local', createserver: 'local' }; },
    getRoomAddress(id) { const r = rooms.get(Number(id)) ?? [...rooms.values()].find(r => r.address === id); return r ? { r: 'success', id, address: r.address, server: 'local', roomname: r.name, password: Boolean(r.password) } : { r: 'fail', e: 'room_not_found' }; },
    matchmaking(body) { const exclude = String(body.excludeaddresses || '').split('#'); const r = [...rooms.values()].find(r => r.quick && r.mode === body.mode && count(r) < r.maxPlayers && !exclude.includes(r.address)); return r ? { r: 'join', address: r.address, server: 'local' } : { r: 'create', server: 'local', lat: 0, long: 0, country: 'na' }; },
    getOnlineCount() { const bonk = { total: 0, quick_classic: 0, quick_arrows: 0, quick_simple: 0, quick_grapple: 0, custom: 0 }; for (const r of rooms.values()) { const n = count(r); bonk.total += n; const key = { bonkquick: 'quick_classic', arrowsquick: 'quick_arrows', simplequick: 'quick_simple', training1: 'quick_simple', grapplequick: 'quick_grapple' }[r.mode] || 'custom'; bonk[key] += n; } return { bonk, car: { total: 0 } }; },
  };
}
