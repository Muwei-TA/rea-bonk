// Isolated, disposable investigation browser; no user profile or credentials.
import fs from 'node:fs/promises';
export async function connect(targetId = process.env.REA_TARGET) {
  const targets = await (await fetch(`http://127.0.0.1:${process.env.DEBUG_PORT || 19327}/json/list`)).json();
  const target = targets.find(t => t.type === 'page' && (targetId ? t.id === targetId : t.url.startsWith(process.env.BONK_URL || 'http://127.0.0.1:3210/')));
  if (!target) throw new Error('Bonk investigation page is unavailable');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id) {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    } else listeners.get(m.method)?.(m.params);
  };
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const key = ++id;
        pending.set(key, { resolve, reject });
        ws.send(JSON.stringify({ id: key, method, params }));
      });
    },
    on(method, fn) { listeners.set(method, fn); },
    close() { ws.close(); },
  };
}
if (process.argv[1]?.endsWith('/cdp.mjs') && process.argv[2]) {
  const c = await connect();
  try {
    const r = await c.send('Runtime.evaluate', { expression: process.argv[2], returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    const value = JSON.stringify(r.result.value, null, 2);
    if (process.argv[3]) await fs.writeFile(process.argv[3], value + '\n');
    else console.log(value);
  } finally { c.close(); }
}
