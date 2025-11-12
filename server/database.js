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
      duration TEXT,
      created_at TEXT,
      downloaded INTEGER DEFAULT 0,
      processed INTEGER DEFAULT 0,
      download_status TEXT DEFAULT 'pending',
      process_status TEXT DEFAULT 'pending',
      download_progress INTEGER DEFAULT 0,
      muted_segments TEXT,
      file_path TEXT,
      processed_file_path TEXT,
      error_message TEXT,
      retry_count INTEGER DEFAULT 0,
      last_attempt_at TEXT
    )
  `);

  // Migrate existing tables - add new columns if they don't exist
  const columns = db.pragma('table_info(vods)');
  const columnNames = columns.map((col) => col.name);

  if (!columnNames.includes('download_status')) {
    db.exec(
      `ALTER TABLE vods ADD COLUMN download_status TEXT DEFAULT 'pending'`
    );
    console.log('Added download_status column');
  }
  if (!columnNames.includes('process_status')) {
    db.exec(
      `ALTER TABLE vods ADD COLUMN process_status TEXT DEFAULT 'pending'`
    );
    console.log('Added process_status column');
  }
  if (!columnNames.includes('download_progress')) {
    db.exec(`ALTER TABLE vods ADD COLUMN download_progress INTEGER DEFAULT 0`);
    console.log('Added download_progress column');
  }
  if (!columnNames.includes('error_message')) {
    db.exec(`ALTER TABLE vods ADD COLUMN error_message TEXT`);
    console.log('Added error_message column');
  }
  if (!columnNames.includes('retry_count')) {
    db.exec(`ALTER TABLE vods ADD COLUMN retry_count INTEGER DEFAULT 0`);
    console.log('Added retry_count column');
  }
  if (!columnNames.includes('last_attempt_at')) {
    db.exec(`ALTER TABLE vods ADD COLUMN last_attempt_at TEXT`);
    console.log('Added last_attempt_at column');
  }

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
