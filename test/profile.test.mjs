import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const script = readFileSync(new URL('../public/local-profile.js', import.meta.url), 'utf8');

async function profileCase(action, username = '社团玩家😀') {
  let resolve;
  const listeners = {};
  const input = { value: 'OldAccount', addEventListener: (event, callback) => { listeners[event] = callback; } };
  const button = { addEventListener: (event, callback) => { listeners.play = callback; } };
  vm.runInNewContext(script, {
    document: { getElementById: id => id === 'guest_nametext' ? input : button },
    window: { alert() {} }, AbortSignal,
    fetch: () => new Promise(r => { resolve = r; }),
  });
  assert.equal(input.value, '', 'unknown-owner cache must not become a default');
  action?.({ input, listeners });
  resolve({ ok: true, json: async () => ({ username }) });
  await new Promise(r => setImmediate(r));
  return input.value;
}
test('forum nickname supports Unicode and late replies preserve user edits or selection', async () => {
  assert.equal(await profileCase(), '社团玩家😀');
  assert.equal(await profileCase(({ input, listeners }) => { input.value = ''; listeners.input(); }), '');
  assert.equal(await profileCase(({ input, listeners }) => { input.value = '自选'; listeners.input(); }), '自选');
  assert.equal(await profileCase(({ input, listeners }) => { input.value = '已进入'; listeners.play({}); }), '已进入');
  assert.equal(await profileCase(({ listeners }) => listeners.play({ stopImmediatePropagation() {} })), '社团玩家😀');
});
