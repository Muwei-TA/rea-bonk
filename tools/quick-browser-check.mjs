import assert from 'node:assert/strict';
import { createAccountCheck } from './account-browser-check.mjs';
const check = await createAccountCheck('quick');
try {
  for (const mode of ['Classic','Arrows','Grapple','Simple']) {
  const a = await check.newPage(), b = await check.newPage();
  async function guest(c, name) {
    await check.click(c, 'guestOrAccountContainer_guestButton'); await check.fill(c, 'guest_nametext', name); await check.click(c, 'guestPlayButton');
    await check.wait(() => check.evaluate(c, `return w.__localBonk.context[61].userName==='${name}';`), 'guest menu');
    await check.click(c, 'pretty_playbutton'); await check.click(c, `sm_gameChoice${mode}`);
  }
  await guest(a, `Quick_${mode}_A`);
  await check.wait(() => check.evaluate(a, 'return w.__localBonk.simulation?.frame>40;'), 'quick game started');
  await check.step('quick_create_autostart', { mode, maps: mode==='Classic'?97:undefined });
  await guest(b, `Quick_${mode}_B`);
  await check.wait(() => check.evaluate(b, 'return w.__localBonk.simulation?.frame>150&&w.__localBonk.simulation.state.discs.filter(Boolean).length===2;'), 'late quick join');
  assert(await check.evaluate(a, 'return w.__localPeers.every(p=>Object.keys(p.connections).length===0);'), 'No direct Peer connections');
  assert(await check.evaluate(b, 'return w.__localPeers.every(p=>Object.keys(p.connections).length===0);'), 'No direct Peer connections');
  const f = Math.min(await check.evaluate(a, 'return w.__localBonk.simulation.frame;'), await check.evaluate(b, 'return w.__localBonk.simulation.frame;')) - 2;
  const x = await check.evaluate(a, `return w.__localBonk.simulation.history[${f}];`), y = await check.evaluate(b, `return w.__localBonk.simulation.history[${f}];`);
  assert.deepEqual(x.discs, y.discs);
  await check.step('quick_match_existing_late_join', { mode, frame: f, players: x.discs.filter(Boolean).length, sameFrameStatesEqual: true, afterCountdown: true, serverRelay: true, directPeers: 0 });
  await check.screenshot(a, mode.toLowerCase()+'-multiplayer');await a.dispose();await b.dispose();
  }
  await check.finish(); console.log(JSON.stringify(check.result));
} finally { await check.close(); }
