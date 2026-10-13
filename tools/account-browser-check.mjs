import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const output = process.env.BONK_OUTPUT || fileURLToPath(new URL('../output/server-zh-20261014', import.meta.url));
const baseURL = process.env.BONK_URL || 'http://127.0.0.1:3210/';
const debugURL = `http://127.0.0.1:${process.env.DEBUG_PORT || 19327}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function createAccountCheck(prefix = 'account') {
  await fs.mkdir(output, { recursive: true });
  const browserInfo = await (await fetch(`${debugURL}/json/version`)).json();
  const ws = new WebSocket(browserInfo.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = e => { const message = JSON.parse(e.data); if (message.id) { const p = pending.get(message.id); pending.delete(message.id); message.error ? p.reject(new Error(message.error.message)) : p.resolve(message.result); } };
  const browser = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })); });
  const result = { started: new Date().toISOString(), steps: [], errors: [], consoleErrors: [], consoleWarnings: [], failedResponses: [], expectedResponses: [], external: [], accounts: [] };
  const contexts = [], pages = [];
  const evaluate = async (c, code) => {
    const response = await c.send('Runtime.evaluate', { expression: `(()=>{const w=document.querySelector('iframe').contentWindow,d=w.document;${code}})()`, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  };
  const wait = async (fn, label, timeout = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) { try { const value = await fn(); if (value) return value; } catch {} await delay(150); }
    throw new Error(`Timed out: ${label}`);
  };
  const inspect = c => evaluate(c, `return {text:d.body.innerText,controls:[...d.querySelectorAll('[id]')].filter(e=>e.getClientRects().length&&w.getComputedStyle(e).visibility==='visible'&&w.getComputedStyle(e).display!=='none'&&((e.innerText?.length||0)<90)).map(e=>({id:e.id,text:e.innerText||'',tag:e.tagName,type:e.type||''})),inputs:[...d.querySelectorAll('input,select')].filter(e=>e.getClientRects().length&&w.getComputedStyle(e).visibility==='visible').map(e=>({id:e.id,type:e.type,value:e.type==='password'?'[redacted]':e.value,options:e.options?[...e.options].map(o=>({text:o.text,value:o.value})):undefined}))};`);
  const click = async (c, elementId) => {
    await wait(() => evaluate(c, `const e=d.getElementById(${JSON.stringify(elementId)});return !!e&&e.getClientRects().length>0&&w.getComputedStyle(e).visibility==='visible';`), `visible ${elementId}`);
    await evaluate(c, `d.getElementById(${JSON.stringify(elementId)}).click();`);
    await delay(300);
  };
  const fill = (c, elementId, value) => evaluate(c, `const e=d.getElementById(${JSON.stringify(elementId)});e.value=${JSON.stringify(value)};e.dispatchEvent(new w.Event('input',{bubbles:true}));e.dispatchEvent(new w.Event('change',{bubbles:true}));`);
  const screenshot = async (c, name) => { await c.send('Page.bringToFront');await delay(650); const shot = await c.send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(`${output}/${prefix}-${name}.png`, Buffer.from(shot.data, 'base64')); };
  const save = async () => fs.writeFile(`${output}/${prefix}-results.json`, JSON.stringify(result, null, 2));
  const step = async (name, evidence) => { result.steps.push({ name, verified: new Date().toISOString(), evidence }); await save(); };
  const newPage = async () => {
    const { browserContextId } = await browser('Target.createBrowserContext'); contexts.push(browserContextId);
    const { targetId } = await browser('Target.createTarget', { url: 'about:blank', browserContextId });
    const targets = await (await fetch(`${debugURL}/json/list`)).json();
    const target = targets.find(t => t.id === targetId);
    const pageSocket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { pageSocket.onopen = resolve; pageSocket.onerror = reject; });
    let pageId = 0; const pagePending = new Map(), listeners = new Map();
    pageSocket.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pagePending.get(m.id); pagePending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } else listeners.get(m.method)?.(m.params); };
    const c = { send: (method, params = {}) => new Promise((resolve, reject) => { const id = ++pageId; pagePending.set(id, { resolve, reject }); pageSocket.send(JSON.stringify({ id, method, params })); }), on: (name, fn) => listeners.set(name, fn), close: () => pageSocket.close() };
    c.dispose=async()=>{c.close();await browser('Target.disposeBrowserContext',{browserContextId});contexts.splice(contexts.indexOf(browserContextId),1);pages.splice(pages.indexOf(c),1);};
    pages.push(c);
    await c.send('Runtime.enable'); await c.send('Network.enable');
    c.on('Runtime.consoleAPICalled',e=>{const message=e.args.map(a=>a.value??a.description??'').join(' ');if(e.type==='error')result.consoleErrors.push(message);if(e.type==='warning')result.consoleWarnings.push(message);});
    c.on('Runtime.exceptionThrown', e => result.errors.push(e.exceptionDetails.exception?.description || e.exceptionDetails.text));
    c.on('Network.responseReceived', e => { if (e.response.status >= 400) { const entry={url:e.response.url,status:e.response.status}; if (e.response.status===404 && new URL(e.response.url).pathname==='/_blackroom/me') result.expectedResponses.push(entry); else result.failedResponses.push(entry); } });
    c.on('Network.requestWillBeSent', e => { if (/^https?:/.test(e.request.url) && new URL(e.request.url).origin !== new URL(baseURL).origin) result.external.push(e.request.url); });
    await c.send('Page.navigate', { url: baseURL });
    await wait(() => evaluate(c, 'return w.__localBonk?.context[61]?.version===49;'), 'client loaded');
    return c;
  };
  const register = async (c, suffix) => {
    const username = `Gui${suffix}${Date.now().toString(36)}`;
    const password = randomBytes(20).toString('base64url');
    await click(c, 'guestOrAccountContainer_accountButton');
    await fill(c, 'registerwindow_username', username); await fill(c, 'registerwindow_password', password);
    await evaluate(c, "d.getElementById('registerwindow_remember_checkbox').checked=true;");
    await click(c, 'registerwindow_submitbutton');
    await wait(() => evaluate(c, `return w.__localBonk.context[61].userName===${JSON.stringify(username)}&&!w.__localBonk.context[61].guest;`), 'UI registration');
    result.accounts.push(username); await step('registration', { username, identity: await evaluate(c, 'const a=w.__localBonk.context[61];return {name:a.userName,id:a.dbid,guest:a.guest};') });
    return { username, password };
  };
  const login = async (c, account) => {
    await click(c, 'guestOrAccountContainer_accountButton');
    await fill(c, 'loginwindow_username', account.username); await fill(c, 'loginwindow_password', account.password);
    await evaluate(c, "d.getElementById('loginwindow_remember_checkbox').checked=true;");
    await click(c, 'loginwindow_submitbutton');
    await wait(() => evaluate(c, `return w.__localBonk.context[61].userName===${JSON.stringify(account.username)}&&!w.__localBonk.context[61].guest;`), 'UI login');
    await step('login', { username: account.username });
  };
  return { baseURL, result, newPage, inspect, evaluate, wait, click, fill, screenshot, step, save, register, login, delay,
    async finish() { result.finished = new Date().toISOString(); result.passed = !result.errors.length && !result.consoleErrors.length && !result.failedResponses.length && !result.external.length; await save(); assert(result.passed, 'Unexpected client errors or external requests'); },
    async close() { await save(); pages.forEach(c => c.close()); for (const browserContextId of contexts) await browser('Target.disposeBrowserContext', { browserContextId }); ws.close(); },
  };
}
