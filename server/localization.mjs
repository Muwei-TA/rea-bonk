import { createHash } from 'node:crypto';

export const originalCoreSHA256 = 'e549ed7b6840a908bc0e9c595321aa5e9dcfa787190bae9b60938e32dfa65c8e';

export function localizeCore(source) {
  if (createHash('sha256').update(source).digest('hex') !== originalCoreSHA256) {
    throw new Error('Client source changed; review the Chinese localization hooks before serving it');
  }
  return source
    .replace('var k7V=B3jF8;', 'var k7V=B3jF8;window.__bonkZh.install(k7V,M$QCc);')
    .replace('function a6N(g_h){', 'function a6N(g_h){arguments[0]=window.__bonkZh.text(arguments[0]);')
    // The editor label can share a word with a Box2D or PIXI member (e.g. Length).
    .replace('function t_N(F4I,t4H,e_S,P70){', 'function t_N(F4I,t4H,e_S,P70){arguments[1]=window.__bonkZh.text(arguments[1]);')
    .replaceAll('"FIRST TO "', '"先赢 "')
    .replaceAll('" WINS"', '" 回合获胜"')
    .replaceAll('"Red Team"', '"红队"')
    .replaceAll('"Blue Team"', '"蓝队"')
    .replaceAll('"Green Team"', '"绿队"')
    .replaceAll('"Yellow Team"', '"黄队"');
}
