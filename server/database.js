import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { config } from 'dotenv';

config();

const dbPath = process.env.DATABASE_PATH || './data/doublelift.db';
let db;

export function initDatabase() {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS vods (
      id TEXT PRIMARY KEY,
      title TEXT,
      url TEXT,
      duration INTEGER,
      created_at TEXT,
      downloaded INTEGER DEFAULT 0,
      processed INTEGER DEFAULT 0,
      muted_segments TEXT,
      file_path TEXT,
      processed_file_path TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS stream_state (
      id INTEGER PRIMARY KEY,
      is_streaming INTEGER DEFAULT 0,
      current_vod_id TEXT,
      playlist_updated_at TEXT,
      last_scan_at TEXT,
      next_scan_at TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS playlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vod_id TEXT,
      position INTEGER,
      added_at TEXT,
      FOREIGN KEY(vod_id) REFERENCES vods(id)
    )
  `);

  const state = db.prepare('SELECT * FROM stream_state WHERE id = 1').get();
  if (!state) {
    db.prepare('INSERT INTO stream_state (id) VALUES (1)').run();
  }

  return db;
}

export function getDatabase() {
  if (!db) {
    initDatabase();
  }
  return db;
}
