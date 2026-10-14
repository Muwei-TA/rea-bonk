import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createAccountCheck } from './account-browser-check.mjs';

const check = await createAccountCheck('multiplayer-isolation');
const pages = [await check.newPage(), await check.newPage()];
const errors = [], missing = [], expectedResponses = [], external = [];
const output = process.env.BONK_OUTPUT || 'output/server-zh-20261014';
await fs.mkdir(output, { recursive: true });
const evaluate = async (c, body) => {
  const r = await c.send('Runtime.evaluate', { expression: `(()=>{const w=document.querySelector('iframe').contentWindow,d=w.document;${body}})()`, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const wait = async (fn, timeout = 18000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) { try { const r = await fn(); if (r) return r; } catch {} await new Promise(r => setTimeout(r, 150)); }
  throw new Error('Browser condition timed out');
};
const click = async (c, id) => {
  await wait(() => evaluate(c, `const e=d.getElementById(${JSON.stringify(id)});return !!e&&w.getComputedStyle(e).visibility==='visible'&&e.getBoundingClientRect().width>0;`));
  return evaluate(c, `d.getElementById(${JSON.stringify(id)}).click();`);
};
const body = c => evaluate(c, 'return d.body.innerText;');
const screenshot = async (c, name) => {
  await c.send('Page.bringToFront');await new Promise(r=>setTimeout(r,650));
  const shot = await c.send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(`${output}/${name}.png`, Buffer.from(shot.data, 'base64'));
};
try {
  for (const [index, c] of pages.entries()) {
    await c.send('Runtime.enable'); await c.send('Network.enable');
    c.on('Runtime.exceptionThrown', e => errors.push({ page: index, description: e.exceptionDetails.exception?.description ?? e.exceptionDetails.text }));
    c.on('Network.responseReceived', e => { if(e.response.status>=400){const entry={status:e.response.status,url:e.response.url};if(e.response.status===404&&new URL(e.response.url).pathname==='/_blackroom/me')expectedResponses.push(entry);else missing.push(entry);} });
    c.on('Network.requestWillBeSent', e => { if (/^https?:/.test(e.request.url) && !e.request.url.startsWith(process.env.BONK_URL || 'http://127.0.0.1:3210/')) external.push(e.request.url); });
    await c.send('Page.reload', { ignoreCache: true });
    await wait(() => evaluate(c, 'return w.__localBonk?.context[61]?.version===49;'));
    await click(c, 'guestOrAccountContainer_guestButton');
    await evaluate(c, `d.getElementById('guest_nametext').value=${JSON.stringify(index ? 'E2E_Bob' : 'E2E_Alice')};`);
    await click(c, 'guestPlayButton');
    await wait(async () => (await body(c)).includes(index ? 'E2E_Bob' : 'E2E_Alice'));
  }
  const [a, b] = pages;
  await screenshot(a, 'local-menu');
  await click(a, 'pretty_playbutton'); await click(a, 'sm_gameChoiceCustom');
  await click(a, 'roomlistcreatebutton');
  await evaluate(a, "d.getElementById('roomlistcreatewindowgamename').value='Local E2E Room';");
  await click(a, 'roomlistcreatecreatebutton');
  await wait(async () => /游戏设置|Game Settings/.test(await body(a)));
  await click(b, 'pretty_playbutton'); await click(b, 'sm_gameChoiceCustom');
  await wait(async () => (await body(b)).includes('Local E2E Room'));
  await evaluate(b, "[...d.querySelectorAll('#roomlisttable tr')].find(e=>e.innerText.includes('Local E2E Room')).click();"); await click(b, 'roomlistjoinbutton');
  await wait(async () => /游戏设置|Game Settings/.test(await body(b)) && (await body(b)).includes('E2E_Alice'));
  assert(await evaluate(a, "return w.__localPeers.every(p=>Object.keys(p.connections).length===0);"), 'Direct peer connections must stay disabled');
  await evaluate(a, "d.getElementById('newbonklobby_chat_input').value='local handshake verified';d.getElementById('newbonklobby_chat_input').focus();");
  await a.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await a.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await wait(async () => (await body(b)).includes('local handshake verified'));
  await screenshot(a, 'local-lobby');
  await click(a,'newbonklobby_mapbutton');await click(a,'maploadtypedropdowntitle');await click(a,'maploadtypedropdownoption11');await wait(()=>evaluate(a,"return [...d.querySelectorAll('#maploadwindowmapscontainer .maploadwindowtextname_picks')].some(e=>e.textContent==='Classic');"));await evaluate(a,"[...d.querySelectorAll('#maploadwindowmapscontainer .maploadwindowtextname_picks')].find(e=>e.textContent==='Classic').parentElement.click();");
  await click(a, 'newbonklobby_startbutton');
  await wait(() => evaluate(a, 'return w.__localBonk.simulation?.frame>150;'));
  await wait(() => evaluate(b, 'return w.__localBonk.simulation?.frame>150;'));
  await a.send('Page.bringToFront');await new Promise(r=>setTimeout(r,250));
  await evaluate(a, 'w.focus();');
  const beforeInput=await evaluate(a,'return w.__localBonk.simulation.state.discs[w.__localBonk.simulation.playerID];');
  await a.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await new Promise(r => setTimeout(r, 500));
  await a.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await new Promise(r => setTimeout(r, 400));
  const commonFrame = Math.min(await evaluate(a, 'return w.__localBonk.simulation.frame;'), await evaluate(b, 'return w.__localBonk.simulation.frame;')) - 2;
  const stateA = await evaluate(a, `return w.__localBonk.simulation.history[${commonFrame}];`);
  const stateB = await evaluate(b, `return w.__localBonk.simulation.history[${commonFrame}];`);
  assert(stateA?.discs?.filter(Boolean).length === 2 && stateB?.discs?.filter(Boolean).length === 2, 'Both players must be simulated');
  assert.deepEqual(stateA.discs, stateB.discs, 'Clients diverged at the same simulation frame');
  const playerID=await evaluate(a,'return w.__localBonk.simulation.playerID;');assert.notEqual(stateA.discs[playerID].x,beforeInput.x,'Direction input must change player X');
  await screenshot(a, 'local-multiplayer-a'); await screenshot(b, 'local-multiplayer-b');
  const transport = await evaluate(a, 'return w.__localPeers.map(p=>Object.values(p.connections).flat().map(c=>({peer:c.peer,open:c.open})));');
  const result = { passed: true, scenario: 'Two real guest clients: UI create/join, Socket.IO server relay, chat, start, movement, equal same-frame physics', commonFrame, movement:{beforeX:beforeInput.x,afterX:stateA.discs[playerID].x}, players: stateA.discs.filter(Boolean).length, transport, errors, missing, expectedResponses, external };
  await fs.writeFile(`${output}/browser-results.json`, JSON.stringify(result, null, 2));
  assert.equal(errors.length, 0, 'Unexpected page exceptions'); assert.equal(missing.length,0,'Missing resources'); assert.equal(external.length, 0, 'Official service requests escaped adapter');
  console.log(JSON.stringify(result));
} finally { await check.close(); }
