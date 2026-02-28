import Database from 'better-sqlite3';

const DB_PATH = '/home/josh/coding/claude/hopper-shared/data/hopper.db';

let db: Database.Database | null = null;

export function getHopperDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}
