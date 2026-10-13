import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { connect } from './cdp.mjs';
const evaluate = async (c, code) => {
  const r = await c.send('Runtime.evaluate', { expression: `(()=>{const w=document.querySelector('iframe').contentWindow,d=w.document;${code}})()`, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const wait = async fn => { for (let i = 0; i < 120; i++) { try { const x = await fn(); if (x) return x; } catch {} await new Promise(r => setTimeout(r, 150)); } throw new Error('Mode browser condition timed out'); };
const ids = (await (await fetch('http://127.0.0.1:19327/json/list')).json()).filter(t => t.url.startsWith('http://127.0.0.1:3210/')).map(t => t.id);
const pages = [];
for (const id of ids) { const c = await connect(id); const name = await evaluate(c, 'return w.__localBonk.context[61].userName;'); if (name === 'E2E_Alice' || name === 'E2E_Bob') pages.push({ c, name }); else c.close(); }
const a = pages.find(p => p.name === 'E2E_Alice')?.c, b = pages.find(p => p.name === 'E2E_Bob')?.c;
assert(a && b);
const errors = [];
for (const c of [a, b]) { await c.send('Runtime.enable'); c.on('Runtime.exceptionThrown', e => errors.push(e.exceptionDetails.exception?.description || e.exceptionDetails.text)); }
const click = async (c, id) => { await wait(() => evaluate(c, `const e=d.getElementById('${id}');return w.getComputedStyle(e).visibility==='visible'&&e.getBoundingClientRect().width>0;`)); await evaluate(c, `d.getElementById('${id}').click();`); };
const results = [];
try {
  for (const [suffix, label] of [['classic','Classic'],['arrow','Arrows'],['deatharrows','Death Arrows'],['grapple','Grapple'],['vtol','VTOL'],['football','Football']]) {
    const old = (await (await fetch('http://127.0.0.1:3210/local/status')).json()).rooms.find(r => r.name === 'Local E2E Room');
    if (old?.startTime) await click(a, 'pretty_top_exit');
    await wait(() => evaluate(a, "return w.getComputedStyle(d.getElementById('newbonklobby_startbutton')).visibility==='visible';"));
    await click(a, 'newbonklobby_modebutton'); await click(a, `newbonklobby_mode_${suffix}`);
    await wait(() => evaluate(b, `return d.getElementById('newbonklobby_modetext').textContent==='${label}';`));
    if (suffix === 'football') { await click(a, 'newbonklobby_bluebutton'); await click(b, 'newbonklobby_redbutton'); }
    await click(a, 'newbonklobby_startbutton');
    await wait(async () => { const r = (await (await fetch('http://127.0.0.1:3210/local/status')).json()).rooms.find(r => r.name === 'Local E2E Room'); return r?.startTime && r.startTime !== old.startTime; });
    await wait(() => evaluate(a, 'return w.__localBonk.simulation?.frame>15&&w.__localBonk.simulation?.frame<300;'));
    await wait(() => evaluate(b, 'return w.__localBonk.simulation?.frame>15&&w.__localBonk.simulation?.frame<300;'));
    const f = Math.min(await evaluate(a, 'return w.__localBonk.simulation.frame;'), await evaluate(b, 'return w.__localBonk.simulation.frame;')) - 2;
    const x = await evaluate(a, `return w.__localBonk.simulation.history[${f}];`), y = await evaluate(b, `return w.__localBonk.simulation.history[${f}];`);
    assert.equal(x.discs.filter(Boolean).length, 2); assert.deepEqual(x.discs, y.discs, `${label} simulation divergence`);
    if (suffix === 'football') assert(x.ball && y.ball, 'Football ball missing');
    const shot = await a.send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(`output/playwright/mode-${suffix}.png`, Buffer.from(shot.data, 'base64'));
    results.push({ mode: label, frame: f, synchronized: true, players: 2, footballBall: !!x.ball });
  }
  assert.equal(errors.length, 0);
  await fs.writeFile('output/playwright/modes-results.json', JSON.stringify({ passed: true, results, errors }, null, 2));
  console.log(JSON.stringify(results));
} finally { pages.forEach(p => p.c.close()); }
