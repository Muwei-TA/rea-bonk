// Supplementary CDP probe; REA remains the source of retained page/script Evidence.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { connect } from './cdp.mjs';
const c = await connect();
try {
  const r = await c.send('Runtime.evaluate', { expression: 'document.querySelector("iframe").contentDocument.getElementById("pretty_tutorialbutton").click()' });
  assert(!r.exceptionDetails);
  await new Promise(r => setTimeout(r, 700));
  await c.send('Profiler.enable');
  await c.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  const startedAt = new Date().toISOString();
  await c.send('Runtime.evaluate', { expression: 'document.querySelector("iframe").contentWindow.focus()' });
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
  await new Promise(r => setTimeout(r, 1300));
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 });
  const coverage = await c.send('Profiler.takePreciseCoverage');
  await c.send('Profiler.stopPreciseCoverage');
  const scripts = coverage.result.filter(s => s.url.startsWith('https://bonk.io/'));
  const core = scripts.find(s => s.url === 'https://bonk.io/js/alpha2s.js');
  assert(core?.functions.some(f => f.ranges.some(r => r.count > 0)), 'Core execution not observed');
  await fs.writeFile('artifacts/evidence/tutorial-execution.json', JSON.stringify({ provider: 'supplementary direct CDP, not REA MCP', startedAt, endedAt: new Date().toISOString(), scenario: 'guest tutorial, ArrowRight held for 1300 ms', limitations: ['Counts show execution within this window, not causal attribution or multiplayer acceptance', 'Profiler disables optimized execution during capture'], coverage: scripts }, null, 2));
  const shot = await c.send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile('artifacts/evidence/tutorial-after-input.png', Buffer.from(shot.data, 'base64'));
  console.log(JSON.stringify({ core_functions: core.functions.length, executed_functions: core.functions.filter(f => f.ranges.some(r => r.count > 0)).length, executed_names: core.functions.filter(f => f.ranges.some(r => r.count > 0)).map(f => f.functionName).filter(Boolean).slice(0,30) }));
} finally {
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }).catch(() => {});
  await c.send('Profiler.stopPreciseCoverage').catch(() => {});
  c.close();
}
