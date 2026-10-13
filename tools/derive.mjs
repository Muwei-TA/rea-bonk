// Inspection-only derivation: preserve original bytes; never execute this output.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const acorn = require('/Users/muwei/.npm/_npx/bdbf2deecdd22bc5/node_modules/acorn');
const prettier = require('/Users/muwei/.npm/_npx/b388654678d519d9/node_modules/prettier');
const source = await fs.readFile('artifacts/raw/alpha2s.js', 'utf8');
const dictionaries = JSON.parse(await fs.readFile('artifacts/derived/runtime-dictionary.json', 'utf8'));
const tree = acorn.parse(source, { ecmaVersion: 'latest', locations: true });
function walk(n, fn) {
  if (!n || typeof n !== 'object') return;
  if (n.type) fn(n);
  for (const v of Object.values(n)) {
    if (Array.isArray(v)) v.forEach(x => walk(x, fn));
    else if (v && typeof v === 'object' && v.type) walk(v, fn);
  }
}
const aliases = new Set();
walk(tree, n => {
  if (n.type === 'AssignmentExpression' && n.operator === '=' && n.right.type === 'Identifier' && n.right.name === 'M$QCc') aliases.add(source.slice(n.left.start, n.left.end));
});
const replacements = [];
walk(tree, n => {
  let value;
  if (n.type === 'MemberExpression' && n.computed && n.property.type === 'Literal' && aliases.has(source.slice(n.object.start, n.object.end))) value = dictionaries.dictionary[n.property.value];
  if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.callee.computed && ['B3jF8', 'k7V'].includes(n.callee.object.name) && ['w65', 'U3q'].includes(n.callee.property.name) && n.arguments.length === 1 && n.arguments[0].type === 'Literal') value = dictionaries.strings[n.arguments[0].value];
  if (typeof value === 'string') replacements.push({ start: n.start, end: n.end, original: source.slice(n.start, n.end), value });
});
const start = source.indexOf('requirejs([');
assert(start > 0);
const selected = replacements.filter(r => r.start >= start).sort((a, b) => b.start - a.start);
let derived = source.slice(start);
for (const r of selected) {
  assert.equal(source.slice(r.start, r.end), r.original);
  derived = derived.slice(0, r.start - start) + JSON.stringify(r.value) + derived.slice(r.end - start);
}
acorn.parse(derived, { ecmaVersion: 'latest' });
derived = await prettier.format(derived, { parser: 'babel' });
await fs.writeFile('artifacts/derived/game.readable.js', '// Inspection-only; runtime string dictionary substitutions; not original source or a runnable rebuild.\n' + derived);
await fs.writeFile('artifacts/derived/substitutions.json', JSON.stringify({ offsets: 'zero-based UTF-16 code units, half-open, original alpha2s.js', extracted_start: start, alias_scope: 'syntactic alias candidates; not a full binding or mutation proof', replacements: selected }, null, 2));
assert(selected.length > 1000);
assert(derived.includes('https://bonk2.io/scripts/getrooms.php'));
assert(derived.includes('Box2DModuleGJMod'));
console.log(JSON.stringify({ dictionary_entries: dictionaries.dictionary.length, recovered_strings: dictionaries.strings.filter(s => typeof s === 'string').length, replacements: selected.length, lines: derived.split('\n').length, parsed: true }));
