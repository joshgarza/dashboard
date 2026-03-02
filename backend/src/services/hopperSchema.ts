import { getHopperDb } from './hopperDb.js';

let initialized = false;

export function initWeeklyReviewSchema(): void {
  if (initialized) return;
  initialized = true;

  const db = getHopperDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS svc_weekly_review_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week TEXT NOT NULL UNIQUE,
      weekly_goals TEXT NOT NULL DEFAULT '[]',
      interviewed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS svc_weekly_review_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL REFERENCES svc_weekly_review_plans(id) ON DELETE CASCADE,
      thought_id INTEGER REFERENCES thoughts(id),
      scheduled_date TEXT NOT NULL,
      day_focus TEXT,
      task_text TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS svc_weekly_review_deferred (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL REFERENCES svc_weekly_review_plans(id) ON DELETE CASCADE,
      thought_id INTEGER REFERENCES thoughts(id),
      task_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unscheduled'
    );

    CREATE TABLE IF NOT EXISTS svc_dashboard_completions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thought_id INTEGER NOT NULL UNIQUE REFERENCES thoughts(id),
      completed_at TEXT NOT NULL DEFAULT (datetime('now')),
      source TEXT NOT NULL DEFAULT 'manual'
    );

    CREATE INDEX IF NOT EXISTS idx_svc_wr_tasks_plan ON svc_weekly_review_tasks(plan_id);
    CREATE INDEX IF NOT EXISTS idx_svc_wr_tasks_date ON svc_weekly_review_tasks(scheduled_date);
    CREATE INDEX IF NOT EXISTS idx_svc_wr_deferred_plan ON svc_weekly_review_deferred(plan_id);
    CREATE INDEX IF NOT EXISTS idx_svc_dc_thought ON svc_dashboard_completions(thought_id);
  `);
}
