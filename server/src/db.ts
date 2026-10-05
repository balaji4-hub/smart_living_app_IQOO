import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DB_PATH = process.env.SL_DB ?? resolve(process.cwd(), 'data/smart_home.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`PRAGMA journal_mode = WAL;`);
db.exec(`PRAGMA foreign_keys = ON;`);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_hue    INTEGER NOT NULL DEFAULT 210,
  currency      TEXT NOT NULL DEFAULT 'USD',
  energy_rate   REAL NOT NULL DEFAULT 0.28,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS homes (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  lat         REAL NOT NULL,
  lon         REAL NOT NULL,
  sqft        INTEGER NOT NULL DEFAULT 1400,
  timezone    TEXT NOT NULL DEFAULT 'UTC',
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id        TEXT PRIMARY KEY,
  home_id   TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  kind      TEXT NOT NULL,
  position  REAL NOT NULL DEFAULT 0,
  accent    TEXT NOT NULL DEFAULT '#5B8DEF',
  x         REAL NOT NULL DEFAULT 0,
  z         REAL NOT NULL DEFAULT 0,
  w         REAL NOT NULL DEFAULT 3,
  d         REAL NOT NULL DEFAULT 3
);

CREATE TABLE IF NOT EXISTS devices (
  id             TEXT PRIMARY KEY,
  home_id        TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  room_id        TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL,
  manufacturer   TEXT NOT NULL,
  model          TEXT NOT NULL,
  favorite       INTEGER NOT NULL DEFAULT 0,
  state          TEXT NOT NULL DEFAULT '{}',
  placement      TEXT NOT NULL DEFAULT '{}',
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_devices_home ON devices(home_id);

CREATE TABLE IF NOT EXISTS scenes (
  id          TEXT PRIMARY KEY,
  home_id     TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT 'sparkles',
  accent      TEXT NOT NULL DEFAULT '#7C5CFF',
  actions     TEXT NOT NULL DEFAULT '[]',
  run_count   INTEGER NOT NULL DEFAULT 0,
  last_run_at INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS automations (
  id          TEXT PRIMARY KEY,
  home_id     TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1,
  trigger     TEXT NOT NULL,
  conditions  TEXT NOT NULL DEFAULT '[]',
  actions     TEXT NOT NULL DEFAULT '[]',
  run_count   INTEGER NOT NULL DEFAULT 0,
  last_run_at INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS telemetry (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id  TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  at         INTEGER NOT NULL,
  payload    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_telemetry_device_at ON telemetry(device_id, at DESC);

CREATE TABLE IF NOT EXISTS energy_samples (
  home_id  TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  minute   INTEGER NOT NULL,
  watts    REAL NOT NULL,
  PRIMARY KEY (home_id, minute)
);

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  home_id     TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  device_id   TEXT,
  kind        TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'info',
  title       TEXT NOT NULL,
  body        TEXT,
  at          INTEGER NOT NULL,
  acknowledged INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_events_home_at ON events(home_id, at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
  id         TEXT PRIMARY KEY,
  home_id    TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  meta       TEXT,
  at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_home_at ON ai_messages(home_id, at);
`);

export function jsonGet<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

type Param = string | number | bigint | null | Uint8Array;

export function all<T>(sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}

export function get<T>(sql: string, ...params: Param[]): T | undefined {
  return db.prepare(sql).get(...params) as unknown as T | undefined;
}

export function run(sql: string, ...params: Param[]): void {
  db.prepare(sql).run(...params);
}