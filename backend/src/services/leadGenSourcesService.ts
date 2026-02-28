import { getHopperDb } from './hopperDb.js';

export interface LeadGenSource {
  id: number;
  name: string;
  url: string | null;
  sort_order: number;
  created_at: string;
}

function initTable() {
  const db = getHopperDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS svc_lead_gen_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Migrate: add sort_order if it doesn't exist yet
  const cols = db.pragma('table_info(svc_lead_gen_sources)') as { name: string }[];
  if (!cols.some((c) => c.name === 'sort_order')) {
    db.exec('ALTER TABLE svc_lead_gen_sources ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
  }
}

export function getAllSources(): LeadGenSource[] {
  initTable();
  const db = getHopperDb();
  return db.prepare('SELECT * FROM svc_lead_gen_sources ORDER BY sort_order ASC, created_at ASC').all() as LeadGenSource[];
}

export function createSource(name: string, url: string | null): LeadGenSource {
  initTable();
  const db = getHopperDb();
  const row = db.prepare('SELECT MAX(sort_order) as max_order FROM svc_lead_gen_sources').get() as { max_order: number | null };
  const nextOrder = (row.max_order ?? -1) + 1;
  const result = db.prepare(
    'INSERT INTO svc_lead_gen_sources (name, url, sort_order) VALUES (?, ?, ?) RETURNING *'
  ).get(name, url ?? null, nextOrder) as LeadGenSource;
  return result;
}

export function updateSource(id: number, name: string, url: string | null): LeadGenSource | null {
  initTable();
  const db = getHopperDb();
  const result = db.prepare(
    'UPDATE svc_lead_gen_sources SET name = ?, url = ? WHERE id = ? RETURNING *'
  ).get(name, url ?? null, id) as LeadGenSource | undefined;
  return result ?? null;
}

export function reorderSources(orderedIds: number[]): void {
  initTable();
  const db = getHopperDb();
  const update = db.prepare('UPDATE svc_lead_gen_sources SET sort_order = ? WHERE id = ?');
  const tx = db.transaction(() => {
    orderedIds.forEach((id, index) => update.run(index, id));
  });
  tx();
}

export function deleteSource(id: number): boolean {
  initTable();
  const db = getHopperDb();
  const result = db.prepare('DELETE FROM svc_lead_gen_sources WHERE id = ?').run(id);
  return result.changes > 0;
}
