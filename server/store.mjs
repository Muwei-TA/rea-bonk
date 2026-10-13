import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function createStore(dataDir) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const filename = join(dataDir, 'local-bonk.sqlite');
  const db = new DatabaseSync(filename);
  chmodSync(filename, 0o600);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0,
      avatars TEXT NOT NULL DEFAULT '["","","","",""]',
      active_avatar INTEGER NOT NULL DEFAULT 1, controls TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS tokens (
      hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS friendships (
      sender INTEGER NOT NULL REFERENCES users(id), recipient INTEGER NOT NULL REFERENCES users(id),
      accepted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(sender,recipient), CHECK(sender != recipient)
    );
    CREATE TABLE IF NOT EXISTS maps (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL, leveldata TEXT NOT NULL, public INTEGER NOT NULL,
      mo TEXT NOT NULL, publisheddate TEXT NOT NULL, remix TEXT NOT NULL,
      UNIQUE(user_id,name)
    );
    CREATE TABLE IF NOT EXISTS favourites (
      user_id INTEGER NOT NULL REFERENCES users(id), map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
      PRIMARY KEY(user_id,map_id)
    );
    CREATE TABLE IF NOT EXISTS votes (
      user_id INTEGER NOT NULL REFERENCES users(id), map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
      vote INTEGER NOT NULL CHECK(vote IN (0,1)), PRIMARY KEY(user_id,map_id)
    );
    CREATE TABLE IF NOT EXISTS replays (
      id INTEGER PRIMARY KEY, replaydata TEXT NOT NULL, version TEXT NOT NULL,
      map_id INTEGER, mode TEXT NOT NULL, created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS replay_reports (
      replay_id INTEGER NOT NULL REFERENCES replays(id) ON DELETE CASCADE,
      reporter TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(replay_id,reporter)
    );
  `);
  return {
    get: (sql, ...args) => db.prepare(sql).get(...args),
    all: (sql, ...args) => db.prepare(sql).all(...args),
    run: (sql, ...args) => db.prepare(sql).run(...args),
    transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try { const value = fn(); db.exec('COMMIT'); return value; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close: () => db.close(),
  };
}
