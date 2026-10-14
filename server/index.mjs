import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { localizeCore } from './localization.mjs';
import { runtimeConfig } from './config.mjs';
import { createApi } from './api.mjs';
import { attachRooms } from './realtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'public');
const { port, host, allowedOrigin } = runtimeConfig();
let realtime;
const quickPool = JSON.parse(await fs.readFile(path.join(publicRoot, 'local-maps.json'), 'utf8'));
const api = createApi({
  dataDir: process.env.DATA_DIR || path.join(root, 'data'),
  builtinMaps: JSON.parse(await fs.readFile(path.join(publicRoot, 'local-map-catalog.json'), 'utf8')),
  getRooms: (...a) => realtime.getRooms(...a), getRoomAddress: (...a) => realtime.getRoomAddress(...a),
  matchmaking: (...a) => realtime.matchmaking(...a), getOnlineCount: () => realtime.getOnlineCount(),
  getRoomForUser: id => realtime?.getRoomForUser(id) ?? null,
});
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8' };
const patchedCore = localizeCore(await fs.readFile(path.join(publicRoot, 'js/alpha2s.js'), 'utf8'))
  // The obfuscator hashes its deployment hostname; keep that check local to its closure.
  .replace('var s30=B3jF8[131198];', "var s30={location:{hostname:'bonk.io',href:'https://bonk.io/gameframe-release.html'}};")
  .replace('requirejs([', 'window.__localRequire([')
  // Inputs already use Socket.IO; disable the parallel direct-peer channel.
  .replace('w0O[216]=true;', 'w0O[216]=false;')
  .replace('if(t$e[61][B2Y[1][552]](k7V.w65(1532)) != k7V.U3q(4291)){j0e[385][B2Y[1][754]]=t$e[61][B2Y[1][552]](k7V.w65(1532));}', '')
  // These retained quick-play handlers were not bound in the captured menu.
  .replace('function y_i(){', "document.getElementById('sm_gameChoiceSimple').onclick=y_i;document.getElementById('sm_gameChoiceGrapple').onclick=H01;document.getElementById('sm_gameChoiceQuickGrappleCount').textContent='服务器快速匹配';function y_i(){")
  // Local map timestamps are stored in UTC, unlike the original New York backend.
  .replaceAll('moment(', 'moment.utc(')
  .replace('var t$e=[arguments];', 'var t$e=[arguments];window.__localBonk={context:t$e};')
  .replace('t$e[5]=M$QCc;', 't$e[5]=M$QCc;Object.defineProperties(window.__localBonk,{codec:{get:()=>Y},network:{get:()=>D}});')
  .replace('function f7E(g5K){', "window.__localInviteJoin=(address,roomName,password='')=>{s6h('加入游戏');a6N('正在连接房间服务器…');f7E({action:'join',quick:false,address,password,roomName,server:'local',mo:'b'});};function f7E(g5K){")
  .replace('var a5H=[arguments];', 'var a5H=[arguments];window.__localBonk.simulation={get frame(){return a5H[6];},get state(){return a5H[4][a5H[6]];},get history(){return a5H[4];},get playerID(){return a5H[44];}};');

const server = http.createServer(async (req, res) => {
  try {
    if (!allowedOrigin(req.headers.origin)) { res.writeHead(403); res.end('Origin not allowed'); return; }
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self'; frame-ancestors 'self'`);
    if (url.pathname === '/health') {
      res.setHeader('Content-Type', mime['.json']);
      res.end(JSON.stringify({ ok: true, transport: 'socket.io', rooms: realtime.rooms.size, players: realtime.getOnlineCount().bonk.total })); return;
    }
    if (url.pathname === '/local/status' && process.env.ENABLE_DIAGNOSTICS === '1') {
      res.setHeader('Content-Type', mime['.json']); res.end(JSON.stringify({ online: realtime.getOnlineCount(), rooms: [...realtime.rooms.values()].map(r => ({ id: r.id, address: r.address, name: r.name, host: r.host, startTime: r.startTime, players: r.players.map(p => p && ({ name: p.userName, team: p.team, peerID: p.peerID })) })) })); return;
    }
    if (url.pathname.startsWith('/scripts/')) {
      if (!['GET', 'POST'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      let raw = '';
      for await (const b of req) { raw += b; if (Buffer.byteLength(raw) > 4_000_000) { res.writeHead(413); res.end(); return; } }
      let body = Object.fromEntries(url.searchParams);
      if (raw) body = req.headers['content-type']?.includes('application/json') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
      if (url.pathname === '/scripts/autojoin.php') { res.setHeader('Content-Type', mime['.json']); res.end(JSON.stringify({ r: 'success', total: realtime.getOnlineCount().bonk.total })); return; }
      if (await api.handle(url.pathname, body, req, res)) return;
      res.writeHead(404); res.end('Unknown endpoint'); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const filename = path.resolve(publicRoot, '.' + pathname);
    if (!filename.startsWith(publicRoot + path.sep)) { res.writeHead(403); res.end(); return; }
    let bytes;
    if (pathname === '/js/alpha2s.js') bytes = patchedCore;
    else if (pathname === '/gameframe-release.html') {
      bytes = (await fs.readFile(filename, 'utf8')).replace('<script data-main=', '<script src="/local-profile.js"></script><script src="/local-adapter.js"></script><script data-main=');
    } else bytes = await fs.readFile(filename);
    res.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch (e) {
    if (!res.headersSent) res.writeHead(e.code === 'ENOENT' ? 404 : 400, { 'Content-Type': 'text/plain' });
    res.end(e.code === 'ENOENT' ? 'Not found' : 'Invalid request');
  }
});
const io = new Server(server, { allowEIO3: true, serveClient: false, maxHttpBufferSize: 4_000_000, allowRequest: (req, done) => done(null, allowedOrigin(req.headers.origin)) });
realtime = attachRooms(io, api, { quickMaps: () => quickPool });
server.listen(port, host, () => console.log(`黑房弹球: ${host}:${port} (Socket.IO 服务器联机)`));
let closing = false;
function close() { if (closing) return; closing = true; io.close(); api.close(); setTimeout(() => process.exit(0), 250).unref(); }
process.on('SIGINT', close); process.on('SIGTERM', close);
