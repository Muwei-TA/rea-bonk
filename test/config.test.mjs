import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeConfig } from '../server/config.mjs';

test('canonical public origin works behind TLS without trusting forwarded headers', () => {
  const config = runtimeConfig({ PORT: '3210', HOST: '0.0.0.0', PUBLIC_ORIGIN: 'https://bonk.muwei.xyz' });
  assert.equal(config.host, '0.0.0.0');
  assert(config.allowedOrigin('https://bonk.muwei.xyz'));
  assert(config.allowedOrigin(undefined));
  for (const origin of ['https://bonk.muwei.xyz.evil.test', 'https://other.muwei.xyz', 'null']) assert(!config.allowedOrigin(origin));
  for (const origin of ['https://user:pass@example.com', 'https://example.com/', 'file:///tmp/game']) {
    assert.throws(() => runtimeConfig({ PUBLIC_ORIGIN: origin }));
  }
  for (const port of ['NaN', '0', '65536']) assert.throws(() => runtimeConfig({ PORT: port }));
});
