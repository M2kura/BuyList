import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, 'buylist.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

// Every user-owned table carries user_id, so ownership is always `WHERE id = ? AND user_id = ?`.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lists (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    emoji      TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS items (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    list_id    TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    links      TEXT NOT NULL DEFAULT '[]',  -- JSON array of http(s) URLs
    price      REAL,                        -- per piece
    currency   TEXT NOT NULL DEFAULT 'CZK',
    quantity   INTEGER NOT NULL DEFAULT 1,
    deadline   TEXT,                        -- YYYY-MM-DD, "buy by"
    priority   INTEGER NOT NULL DEFAULT 1,  -- 0 low, 1 normal, 2 high
    note       TEXT NOT NULL DEFAULT '',
    bought_at  INTEGER,                     -- null = still to buy
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_lists_user    ON lists(user_id);
  CREATE INDEX IF NOT EXISTS idx_items_user    ON items(user_id);
  CREATE INDEX IF NOT EXISTS idx_items_list    ON items(list_id);
`);
