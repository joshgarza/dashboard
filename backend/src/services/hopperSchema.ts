import { getHopperDb } from './hopperDb.js';

let weeklyReviewInitialized = false;
let researchInitialized = false;

export function initWeeklyReviewSchema(): void {
  if (weeklyReviewInitialized) return;
  weeklyReviewInitialized = true;

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

export function initResearchSchema(): void {
  if (researchInitialized) return;
  researchInitialized = true;

  const db = getHopperDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS svc_research_chat_threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS svc_research_chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL REFERENCES svc_research_chat_threads(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(thread_id, sort_order)
    );

    CREATE TABLE IF NOT EXISTS svc_research_chat_thread_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL REFERENCES svc_research_chat_threads(id) ON DELETE CASCADE,
      file_key TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      UNIQUE(thread_id, file_key),
      UNIQUE(thread_id, sort_order)
    );

    CREATE INDEX IF NOT EXISTS idx_svc_rct_updated_at ON svc_research_chat_threads(updated_at);
    CREATE INDEX IF NOT EXISTS idx_svc_rcm_thread_sort ON svc_research_chat_messages(thread_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_svc_rctf_thread_sort ON svc_research_chat_thread_files(thread_id, sort_order);
  `);
}
