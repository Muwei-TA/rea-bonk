import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/store.mjs';

test('SQLite disk limit refuses growth while retaining saved content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bonk-quota-'));
  const store = createStore(dir);
  try {
    assert.equal(store.get('PRAGMA page_size').page_size * store.get('PRAGMA max_page_count').max_page_count, 1024 ** 3);
    store.run("INSERT INTO users(name,password) VALUES('SavedPlayer','fixture')");
    const pages = store.get('PRAGMA page_count').page_count;
    store.get(`PRAGMA max_page_count=${pages}`);
    assert.throws(() => store.run('INSERT INTO replays(replaydata,version,mode,created) VALUES(?,?,?,?)', 'x'.repeat(65536), '49', 'b', Date.now()), /full/);
    assert.equal(store.get('SELECT COUNT(*) AS n FROM users').n, 1);
    assert.equal(store.get('SELECT COUNT(*) AS n FROM replays').n, 0);
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});
