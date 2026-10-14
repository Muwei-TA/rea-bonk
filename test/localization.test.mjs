import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { localizeCore, originalCoreSHA256 } from '../server/localization.mjs';

const core = await fs.readFile(new URL('../public/js/alpha2s.js', import.meta.url), 'utf8');
const zh = await fs.readFile(new URL('../public/local-zh.js', import.meta.url), 'utf8');
const page = await fs.readFile(new URL('../public/gameframe-release.html', import.meta.url), 'utf8');

function translations() {
  const context = { window: {}, document: { addEventListener() {} } };
  vm.runInNewContext(zh, context);
  return context.window.__bonkZh;
}

test('retained client hash and localization insertion points are verified', () => {
  assert.equal(createHash('sha256').update(core).digest('hex'), originalCoreSHA256);
  const localized = localizeCore(core);
  assert.match(localized, /window\.__bonkZh\.install\(k7V,M\$QCc\)/);
  assert.match(localized, /arguments\[1\]=window\.__bonkZh\.text\(arguments\[1\]\)/);
  new vm.Script(localized);
  assert.throws(() => localizeCore(core + '\n'), /Client source changed/);
});

test('only known display constants change; engine members and protocol remain intact', () => {
  const translator = translations();
  const values = ['Classic', 'SURE?', 'open', 'connect', 'create', 'string', 'property', 'Copy', 'Length', 'Graphics', 'Group', 'Joints', 'Shapes', 'Set', 'Add', 'In', 'Out', 'NORMAL', 'test', 'by', 'b', 'bs', 'ar', 'ard', 'sp', 'f', 'v', 'success', 'true', 'false'];
  const decoders = { w65: index => values[index], U3q: index => values[index] };
  const dictionary = [...values];
  translator.install(decoders, dictionary);
  assert.equal(dictionary[0], '经典');
  assert.equal(dictionary[1], '确认？');
  for (let index = 2; index < values.length; index++) {
    assert.equal(dictionary[index], values[index]);
    assert.equal(decoders.w65(index), values[index]);
  }
  assert.equal(decoders.w65(1), decoders.U3q(1), 'confirmation checks and display share the translated value');
  assert.equal(translator.text('Length'), '长度', 'editor labels translate separately from engine members');
  assert.equal(translator.text('constructor'), 'constructor');
  assert.equal(translator.text('Apocalypse'), 'Apocalypse', 'map titles remain as authored');
  assert.equal(translator.text('MuadDib'), 'MuadDib', 'author names remain as authored');
});

test('static controls preserve protocol values and load translations before the client', () => {
  assert.match(page, /<html lang="zh-CN">/);
  assert.match(page, /value="true"/);
  assert.match(page, /value="false"/);
  assert.ok(page.indexOf('src="local-zh.js"') < page.indexOf('data-main="js/alpha2s"'));
  assert.match(page, /MuadDib/);
  assert.match(page, /Apocalypse/);
  assert.match(page, /自定义房间/);
  assert.match(page, /皮肤管理/);
});

test('bundled Moment displays Chinese relative dates while preserving stored date formats', async () => {
  const context = { document: { addEventListener() {} } };
  context.window = context;
  vm.runInNewContext(await fs.readFile(new URL('../public/js/moment.min.js', import.meta.url), 'utf8'), context);
  vm.runInNewContext(zh, context);
  const now = context.moment.utc('2026-10-14T00:00:00Z');
  assert.equal(context.moment.utc('2026-10-13T00:00:00Z').from(now), '1天前');
  assert.equal(context.moment.utc('2026-10-14T02:00:00Z').from(now), '2小时后');
  assert.equal(now.format('YYYY-MM-DD HH:mm:ss'), '2026-10-14 00:00:00');
  assert.equal(context.__bonkZh.text('P2P ready'), '游戏客户端已就绪');
});
