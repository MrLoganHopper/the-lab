import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

export function initDb(filename) {
  mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id_hash TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'visitor',
      user_key TEXT,
      display_name TEXT,
      email TEXT,
      tokens TEXT,
      oauth_state TEXT,
      oauth_expires_at INTEGER,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      user_key TEXT NOT NULL,
      display_name TEXT NOT NULL,
      email TEXT,
      mode TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      google_event_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bookings_interval ON reservations(start_time,end_time,status);
    CREATE INDEX IF NOT EXISTS idx_bookings_user ON reservations(user_key,start_time);
  `);
  return db;
}

export const generateId = () => randomBytes(24).toString('base64url');
export const hashId = (raw) => createHash('sha256').update(raw).digest('hex');

export function countAt(db, start, end) {
  return db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE status IN ('pending','confirmed') AND start_time < ? AND end_time > ?").get(end, start).n;
}

export function reserveAtomically(db, { id, userKey, name, email, mode, start, end, capacity }) {
  // SQLite transactions serialize writes. Count + insert execute under one write lock.
  // This remains correct with concurrent requests and differently sized time intervals.
  return db.transaction(() => {
    if (countAt(db, start, end) >= capacity) return { error: 'FULL' };
    const existing = db.prepare("SELECT id FROM reservations WHERE user_key=? AND status IN ('pending','confirmed') AND start_time < ? AND end_time > ? LIMIT 1")
      .get(userKey, end, start);
    if (existing) return { error: 'DUPLICATE' };
    db.prepare(`INSERT INTO reservations(id,user_key,display_name,email,mode,start_time,end_time,status,created_at)
      VALUES (?,?,?,?,?,?,?,'pending',?)`)
      .run(id, userKey, name, email, mode, start, end, new Date().toISOString());
    return { id };
  }).immediate();
}
