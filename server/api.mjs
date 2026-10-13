import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { createStore } from './store.mjs';

const scrypt = promisify(scryptCallback);
const hash = value => createHash('sha256').update(value).digest('hex');
const yes = value => value === true || value === 'true' || value === '1' || value === 1;
const success = data => ({ r: 'success', ...data });
const fail = e => ({ r: 'fail', e });
const level = xp => Math.floor(Math.sqrt(xp) / 10) + 1;
const usernameOK = value => typeof value === 'string' && /^[A-Za-z0-9_]{3,25}$/.test(value);
const stringOK = (value, max, allowEmpty = false) => typeof value === 'string' && (allowEmpty || value.length > 0) && Buffer.byteLength(value) <= max;
const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const n = typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)) ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
};
async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`;
}
async function passwordMatches(password, saved) {
  if (!stringOK(password, 1024)) return false;
  const [salt, key] = saved.split(':');
  return timingSafeEqual(await scrypt(password, salt, 64), Buffer.from(key, 'hex'));
}

export function createApi({ dataDir, getRooms, getRoomAddress, matchmaking, getOnlineCount = () => 0, getRoomForUser = () => null, builtinMaps = [] }) {
  const db = createStore(dataDir);
  const attempts = new Map();
  const sessionUser = (token, kind = 'session') => {
    if (!stringOK(token, 128)) return null;
    return db.get('SELECT users.* FROM users JOIN tokens ON users.id=tokens.user_id WHERE tokens.hash=? AND tokens.kind=? AND tokens.expires>?', hash(token), kind, Date.now()) || null;
  };
  const getUser = token => {
    const user = sessionUser(token);
    if (!user) return null;
    return { id: user.id, name: user.name, userName: user.name, guest: false, xp: user.xp, level: level(user.xp), avatar: JSON.parse(user.avatars)[user.active_avatar - 1], controls: user.controls };
  };
  const friends = userId => db.all(`SELECT u.id,u.name FROM friendships f JOIN users u
    ON u.id=CASE WHEN f.sender=? THEN f.recipient ELSE f.sender END
    WHERE (f.sender=? OR f.recipient=?) AND f.accepted=1 ORDER BY u.name`, userId, userId, userId)
    .map(friend => ({ ...friend, roomid: getRoomForUser(friend.id) ?? null }));
  const issueToken = (id, kind) => {
    const token = randomBytes(32).toString('base64url');
    db.run('DELETE FROM tokens WHERE expires<=?', Date.now());
    db.run('INSERT INTO tokens VALUES(?,?,?,?)', hash(token), id, kind, Date.now() + (kind === 'remember' ? 365 : 7) * 86400000);
    return token;
  };
  const account = (user, rememberToken = '') => {
    const avatars = JSON.parse(user.avatars);
    return success({ token: issueToken(user.id, 'session'), rememberToken, id: user.id,
      username: user.name, userName: user.name, name: user.name, guest: false, xp: user.xp, level: level(user.xp),
      avatar: avatars[user.active_avatar - 1], ...Object.fromEntries(avatars.map((a, i) => [`avatar${i + 1}`, a])),
      activeAvatarNumber: user.active_avatar, controls: user.controls, friends: friends(user.id), legacyFriends: '' });
  };
  const mapRow = id => db.get('SELECT * FROM maps WHERE id=?', id);
  const voteMap = (userId, mapId, vote) => {
    userId = integer(userId, 1); mapId = integer(mapId, 1); vote = integer(vote, 0, 1);
    if (!userId || !db.get('SELECT id FROM users WHERE id=?', userId)) return fail('token');
    if (!mapId || vote === null) return fail('data_invalid');
    const map = mapRow(mapId);
    if (!map || !map.public) return fail('map_unpublished');
    db.run('INSERT INTO votes VALUES(?,?,?) ON CONFLICT(user_id,map_id) DO UPDATE SET vote=excluded.vote', userId, mapId, vote);
    return success();
  };
  const mapSelect = `SELECT m.id,m.name,u.name AS authorname,m.leveldata,m.publisheddate,m.publisheddate AS creationdate,m.mo,m.public,
    (SELECT COUNT(*) FROM votes v WHERE v.map_id=m.id AND v.vote=1) AS vu,
    (SELECT COUNT(*) FROM votes v WHERE v.map_id=m.id AND v.vote=0) AS vd
    FROM maps m JOIN users u ON u.id=m.user_id`;
  async function dispatch(path, b, req) {
    const user = sessionUser(b.token);
    if (path === 'register_legacy.php' || path === 'login_legacy.php') {
      // A reverse proxy gives every player the same IP; keep account buckets separate.
      const ip = `${req.socket?.remoteAddress || 'local'}:${hash(String(b.username ?? '').toLowerCase())}`;
      const now = Date.now();
      for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
      const rate = attempts.get(ip) || { count: 0, until: now + 60000 };
      attempts.set(ip, rate);
      if (++rate.count > 30) return fail('rate_limited');
      if (!stringOK(b.username, 100) || !stringOK(b.password, 1024)) return fail('data_missing');
      if (path === 'register_legacy.php') {
        if (!usernameOK(b.username)) return fail('username_invalid');
        if (b.password.length < 8) return fail('password_weak');
        if (db.get('SELECT id FROM users WHERE name=?', b.username)) return fail('username_taken');
        const saved = await passwordHash(b.password);
        // Recheck after scrypt yields: concurrent registrations must not leak a SQLite error.
        if (db.get('SELECT id FROM users WHERE name=?', b.username)) return fail('username_taken');
        const id = Number(db.run('INSERT INTO users(name,password) VALUES(?,?)', b.username, saved).lastInsertRowid);
        return account(db.get('SELECT * FROM users WHERE id=?', id), yes(b.remember) ? issueToken(id, 'remember') : '');
      }
      const found = db.get('SELECT * FROM users WHERE name=?', b.username);
      if (!found) return fail('username_fail');
      if (!await passwordMatches(b.password, found.password)) return fail('password');
      const current = db.get('SELECT * FROM users WHERE id=?', found.id);
      if (!current || current.password !== found.password) return fail('password');
      return account(current, yes(b.remember) ? issueToken(current.id, 'remember') : '');
    }
    if (path === 'login_auto.php') {
      const remembered = sessionUser(b.rememberToken, 'remember');
      return remembered ? account(remembered) : fail('token');
    }
    if (path === 'login_clearauto.php') {
      if (!stringOK(b.rememberToken, 128)) return fail('token');
      db.run("DELETE FROM tokens WHERE hash=? AND kind='remember'", hash(b.rememberToken));
      return success();
    }
    if (path === 'getrooms.php') {
      const result = getRooms ? await getRooms(b, req) : [];
      const onlineFriends = user ? friends(user.id).filter(friend => friend.roomid !== null) : [];
      return Array.isArray(result) ? success({ rooms: result, friends: onlineFriends, lat: '', long: '', city: '', country: '', createserver: '' }) : { ...result, friends: onlineFriends };
    }
    if (path === 'getroomaddress.php') return getRoomAddress ? (await getRoomAddress(b.id, b, req)) || fail('room_not_found') : fail('room_not_found');
    if (path === 'matchmaking_query.php') return matchmaking ? await matchmaking(b, req) : fail('unsupported');
    if (path === 'combinedplayercount.txt') {
      const count = await getOnlineCount();
      return typeof count === 'object' && count !== null ? count : {
        bonk: { total: Number(count) || 0, classic: Number(count) || 0, custom: Number(count) || 0, quick_classic: 0, quick_arrows: 0, quick_simple: 0, quick_grapple: 0 }, car: { total: 0 },
      };
    }
    if (path === 'matchmaking_maps.php') return success({ t1: [...db.all(`${mapSelect} WHERE m.public=1 AND m.mo='bs' ORDER BY m.id DESC LIMIT 32`), ...builtinMaps.filter(m => ['Classic', 'Balance', 'Altum'].includes(m.name))] });
    if (path.startsWith('hotmaps/')) return success({ maps: [...db.all(`${mapSelect} WHERE m.public=1 ORDER BY vu DESC,m.id DESC LIMIT 128`), ...builtinMaps] });
    if (path === 'replay_get.php') {
      const offset = integer(b.offset ?? 0, 0, 1000000);
      const from = integer(b.startingFrom ?? Number.MAX_SAFE_INTEGER, 1);
      if (offset === null || from === null || !stringOK(String(b.version ?? ''), 32, true)) return fail('data_invalid');
      let sql = 'SELECT id,replaydata FROM replays WHERE id<=?';
      const args = [from];
      if (b.version !== undefined) { sql += ' AND version=?'; args.push(String(b.version)); }
      if (b.mode !== undefined) {
        if (!stringOK(b.mode, 30)) return fail('data_invalid');
        sql += ' AND mode=?'; args.push(b.mode);
      }
      return success({ replays: db.all(`${sql} ORDER BY id DESC LIMIT 10 OFFSET ?`, ...args, offset) });
    }
    if (path === 'replay_submit.php') {
      if (!stringOK(b.replaydata, 4 * 1024 * 1024) || !stringOK(String(b.version ?? ''), 32) || !stringOK(b.mode ?? '', 30, true)) return fail('data_invalid');
      const mapId = Number(b.mapid ?? 0);
      if (!Number.isSafeInteger(mapId) || mapId < -1000000) return fail('data_invalid');
      const id = Number(db.run('INSERT INTO replays(replaydata,version,map_id,mode,created) VALUES(?,?,?,?,?)', b.replaydata, String(b.version), mapId, b.mode || mapRow(mapId)?.mo || '', Date.now()).lastInsertRowid);
      return success({ id });
    }
    if (path === 'replay_report.php') {
      const id = integer(b.replayid, 1);
      if (!id || !db.get('SELECT id FROM replays WHERE id=?', id)) return fail('replay_not_found');
      const reporter = hash(req.socket?.remoteAddress || 'local');
      db.run('INSERT OR IGNORE INTO replay_reports VALUES(?,?,?)', id, reporter, Date.now());
      return success();
    }
    if (['map_getfresh.php', 'map_getsearch.php', 'map_getown.php', 'map_getfave.php'].includes(path)) {
      if ((path === 'map_getown.php' || path === 'map_getfave.php') && !user) return fail('token');
      const offset = integer(b.startingfrom ?? 0, 0, 1000000);
      if (offset === null) return fail('data_invalid');
      const limit = path === 'map_getown.php' ? 30 : 32;
      let where = 'm.public=1';
      const args = [];
      if (path === 'map_getown.php') { where = 'm.user_id=?'; args.push(user.id); }
      if (path === 'map_getfave.php') { where += ' AND m.id IN (SELECT map_id FROM favourites WHERE user_id=?)'; args.push(user.id); }
      if (path === 'map_getsearch.php') {
        if (!stringOK(b.searchstring ?? '', 200, true)) return fail('data_invalid');
        const fields = [];
        if (yes(b.searchauthor)) fields.push('u.name');
        if (yes(b.searchmapname)) fields.push('m.name');
        if (!fields.length) fields.push('m.name');
        where += ` AND (${fields.map(field => `instr(lower(${field}),lower(?))>0`).join(' OR ')})`;
        args.push(...fields.map(() => b.searchstring || ''));
      }
      const order = b.searchsort === 'best' ? '(vu-vd) DESC,m.id DESC' : 'm.id DESC';
      const maps = db.all(`${mapSelect} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, ...args, limit + 1, offset);
      return success({ maps: maps.slice(0, limit), more: maps.length > limit });
    }
    const protectedPaths = ['account_changepassword.php', 'account_savecontrols.php', 'avatar_update.php', 'friends.php', 'map_save_pub.php', 'map_delete.php', 'map_fave.php', 'map_vote.php'];
    if (!protectedPaths.includes(path)) return fail('unsupported');
    if (!user) return fail('token');
    if (path === 'account_changepassword.php') {
      if (!await passwordMatches(b.oldpass, user.password)) return fail('oldpass_wrong');
      if (!stringOK(b.newpass, 1024) || b.newpass.length < 8) return fail('password_weak');
      const saved = await passwordHash(b.newpass);
      const current = sessionUser(b.token);
      if (!current) return fail('token');
      if (current.password !== user.password) return fail('oldpass_wrong');
      db.transaction(() => {
        db.run('UPDATE users SET password=? WHERE id=?', saved, user.id);
        db.run('DELETE FROM tokens WHERE user_id=? AND hash!=?', user.id, hash(b.token));
      });
      return success();
    }
    if (path === 'account_savecontrols.php') {
      if (!stringOK(b.controls, 4096) || !/^[A-Za-z0-9+/]*={0,2}$/.test(b.controls)) return fail('data_invalid');
      db.run('UPDATE users SET controls=? WHERE id=?', b.controls, user.id);
      return success();
    }
    if (path === 'avatar_update.php') {
      if (b.task === 'updateslot') {
        const slot = integer(b.newactive, 1, 5);
        if (slot === null) return fail('data_invalid');
        db.run('UPDATE users SET active_avatar=? WHERE id=?', slot, user.id);
      } else if (b.task === 'updateavatar') {
        const slot = integer(b.newavatarslot, 1, 5);
        if (slot === null || !stringOK(b.newavatar, 65536, true)) return fail('data_invalid');
        const avatars = JSON.parse(user.avatars); avatars[slot - 1] = b.newavatar;
        db.run('UPDATE users SET avatars=? WHERE id=?', JSON.stringify(avatars), user.id);
      } else return fail('unsupported');
      return success();
    }
    if (path === 'friends.php') {
      if (b.task === 'getfriends') return success({ friends: friends(user.id), requests: db.all('SELECT u.id,u.name FROM friendships f JOIN users u ON u.id=f.sender WHERE f.recipient=? AND f.accepted=0 ORDER BY u.name', user.id) });
      const other = b.task === 'send' && usernameOK(b.theirname) ? db.get('SELECT id FROM users WHERE name=?', b.theirname) : db.get('SELECT id FROM users WHERE id=?', integer(b.theirid, 1) ?? -1);
      if (!other) return fail(b.task === 'send' && !usernameOK(b.theirname) ? 'username_invalid' : 'username_not_found');
      if (other.id === user.id) return fail('cant_friend_self');
      const existing = db.get('SELECT * FROM friendships WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?)', user.id, other.id, other.id, user.id);
      if (b.task === 'send') {
        if (existing?.accepted) return fail('already_friends');
        if (existing?.sender === user.id) return fail('already_sent_request');
        if (existing) { db.run('UPDATE friendships SET accepted=1 WHERE sender=? AND recipient=?', other.id, user.id); return { r: 'accept_success' }; }
        db.run('INSERT INTO friendships(sender,recipient) VALUES(?,?)', user.id, other.id);
        return { r: 'send_success' };
      }
      if (b.task === 'accept') {
        if (!existing || existing.accepted || existing.recipient !== user.id) return fail('request_not_found');
        db.run('UPDATE friendships SET accepted=1 WHERE sender=? AND recipient=?', other.id, user.id);
      } else if (b.task === 'deleterequest' || b.task === 'unfriend') {
        if (!existing || !!existing.accepted !== (b.task === 'unfriend')) return fail('request_not_found');
        db.run('DELETE FROM friendships WHERE sender=? AND recipient=?', existing.sender, existing.recipient);
      } else return fail('unsupported');
      return success();
    }
    if (path === 'map_save_pub.php') {
      if (!stringOK(b.mapname, 150) || !b.mapname.trim() || !stringOK(b.leveldata, 2 * 1024 * 1024) || !stringOK(b.mo ?? 'b', 30, true)) return fail('data_invalid');
      if (![0, 1, '0', '1', true, false, 'true', 'false'].includes(b.public)) return fail('data_invalid');
      const remix = {};
      for (const key of ['rxid', 'rxdb', 'rxn', 'rxa']) {
        if (b[key] !== undefined && !stringOK(String(b[key]), 200, true)) return fail('data_invalid');
        remix[key] = b[key] ?? '';
      }
      const existing = db.get('SELECT id FROM maps WHERE user_id=? AND name=?', user.id, b.mapname);
      if (existing && !yes(b.overwriteok)) return { r: 'overwrite_confirm' };
      const date = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const params = [b.leveldata, yes(b.public) ? 1 : 0, b.mo ?? 'b', date, JSON.stringify(remix)];
      if (existing) {
        db.run('UPDATE maps SET leveldata=?,public=?,mo=?,publisheddate=?,remix=? WHERE id=?', ...params, existing.id);
        return success({ mapid: existing.id });
      }
      const id = Number(db.run('INSERT INTO maps(leveldata,public,mo,publisheddate,remix,user_id,name) VALUES(?,?,?,?,?,?,?)', ...params, user.id, b.mapname).lastInsertRowid);
      return success({ mapid: id });
    }
    const id = integer(b.mapid, 1);
    const map = id && mapRow(id);
    if (!map) return fail('map_not_found');
    if (path === 'map_delete.php') {
      if (map.user_id !== user.id) return fail('forbidden');
      db.run('DELETE FROM maps WHERE id=?', id);
      return success();
    }
    if (path === 'map_vote.php') return voteMap(user.id, id, b.vote);
    if (!map.public) return fail('map_unpublished');
    if (b.action === 'f') {
      db.transaction(() => {
        db.run('INSERT OR IGNORE INTO favourites VALUES(?,?)', user.id, id);
        voteMap(user.id, id, 1);
      });
      return success();
    }
    if (b.action === 'u') {
      const result = db.run('DELETE FROM favourites WHERE user_id=? AND map_id=?', user.id, id);
      return result.changes ? success() : fail('not_faved');
    }
    return fail('data_invalid');
  }
  return {
    getUser, voteMap,
    recordExperience(userId, xp) {
      userId = integer(userId, 1); xp = integer(xp, 0, 1000000);
      if (!userId || xp === null) return null;
      if (xp > 0) db.run('UPDATE users SET xp=MIN(xp+?,1000000000) WHERE id=?', xp, userId);
      const user = db.get('SELECT xp FROM users WHERE id=?', userId);
      return user ? { xp: user.xp, level: level(user.xp) } : null;
    },
    async handle(pathname, body, req, res) {
      if (!pathname.startsWith('/scripts/') && !pathname.startsWith('/api/')) return false;
      const path = pathname.replace(/^\/(scripts|api)\//, '');
      let result;
      if (!['GET', 'POST'].includes(req.method)) {
        res.statusCode = 405; result = fail('method_not_allowed');
      } else if (req.method !== 'POST' && !path.endsWith('.txt')) {
        res.statusCode = 405; result = fail('method_not_allowed');
      } else if (!body || typeof body !== 'object' || Array.isArray(body)) {
        res.statusCode = 400; result = fail('data_invalid');
      } else {
        try { result = await dispatch(path, body, req); }
        catch (error) { console.error('Local API error:', path, error.message); res.statusCode = error.code === 'ERR_SQLITE_ERROR' && error.errcode === 13 ? 507 : 500; result = fail(res.statusCode === 507 ? 'storage_full' : 'server_error'); }
      }
      res.setHeader('Content-Type', `${path.endsWith('.txt') ? 'text/plain' : 'application/json'}; charset=utf-8`);
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(result));
      return true;
    },
    close: () => db.close(),
  };
}
