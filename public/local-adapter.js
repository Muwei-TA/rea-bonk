// Same-origin adapter for the retained client; original gameplay code is preserved.
(function () {
  const localURL = value => {
    if (typeof value !== 'string') return value;
    const url = new URL(value, location.href);
    return ['bonk.io', 'bonk2.io'].includes(url.hostname) ? url.pathname + url.search + url.hash : value;
  };
  $.ajaxPrefilter(options => { options.url = localURL(options.url); });
  const originalFetch = window.fetch;
  window.fetch = (url, options) => originalFetch.call(window, localURL(url), options);
  window.__localSockets = [];
  window.__localPeers = [];
  // shortcut: guest bans bind to this tab, authenticated accounts give stable identity.
  const guestID = sessionStorage.getItem('localGuestID') || crypto.randomUUID();
  sessionStorage.setItem('localGuestID', guestID);
  let roomAddress = '';
  document.getElementById('newbonklobby_linkbutton').addEventListener('click', async event => {
    event.stopImmediatePropagation();
    const url = `${parent.location.origin}/?id=${encodeURIComponent(roomAddress)}`;
    let copied = false;
    try { await navigator.clipboard.writeText(url); copied = true; } catch {}
    const line = document.createElement('div');
    line.textContent = `* ${copied ? '邀请链接已复制' : '邀请链接'}: ${url}`;
    document.getElementById('newbonklobby_chat_content').appendChild(line);
  }, true);
  const invite = new URL(parent.location.href).searchParams.get('id') || new URL(parent.location.href).searchParams.get('room');
  if (invite) {
    const pending = setInterval(async () => {
      if (!document.getElementById('pretty_top_name').textContent.trim() || !window.__localInviteJoin) return;
      clearInterval(pending);
      try {
        const result = await $.post('/scripts/getroomaddress.php', { id: invite });
        if (result.r !== 'success') throw new Error('房间已不存在');
        const password = result.password ? window.prompt('房间密码') : '';
        if (password !== null) window.__localInviteJoin(result.address, result.roomname, password);
      } catch (error) { window.alert(error.message); }
    }, 250);
  }
  window.__localRequire = function (dependencies, callback) {
    // Only readiness is needed by the retained protocol; no RTC connection is created.
    define('server-transport', [], () => ({ peerjs: { Peer: class {
      constructor() { this.connections = {}; window.__localPeers.push(this); }
      on(event, callback) { if (event === 'open') queueMicrotask(() => callback(guestID)); return this; }
      destroy() {}
    } } }));
    dependencies[1] = 'server-transport';
    return requirejs(dependencies, function (io, module, box) {
      const localIO = function (url, options) {
        const socket = io(location.origin, { ...options, forceNew: true, transports: ['websocket'] });
        const emit = socket.emit.bind(socket);
        socket.emit = function (event, data, ...rest) {
          if ([12, 13, '12', '13'].includes(event) && data?.guest) data = { ...data, guestID };
          return emit(event, data, ...rest);
        };
        socket.on('49', address => { roomAddress = address; });
        socket.on('3', (id, host, players, start, unused, address) => { roomAddress = address; });
        window.__localSockets.push(socket);
        return socket;
      };
      callback(localIO, module, box);
    });
  };
})();
