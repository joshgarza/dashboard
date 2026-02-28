/**
 * One-time migration: imports the existing weekly plan JSON and Obsidian vault todos
 * into the Hopper DB, wiring up svc_weekly_review_* tables.
 *
 * Run with:
 *   npx tsx backend/scripts/migrateToHopper.ts
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_PATH = '/home/josh/coding/claude/hopper-shared/data/hopper.db';
const PLANS_PATH = path.resolve(__dirname, '../data/weekly-plans');
const VAULT_PATH = '/mnt/c/Users/josh/OneDrive/Documents/Obsidian/Obsidian Vault';

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema (idempotent) ──────────────────────────────────────────────────────

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

  CREATE INDEX IF NOT EXISTS idx_svc_wr_tasks_plan ON svc_weekly_review_tasks(plan_id);
  CREATE INDEX IF NOT EXISTS idx_svc_wr_tasks_date ON svc_weekly_review_tasks(scheduled_date);
  CREATE INDEX IF NOT EXISTS idx_svc_wr_deferred_plan ON svc_weekly_review_deferred(plan_id);
`);

// ── Helpers ──────────────────────────────────────────────────────────────────

interface ExistingThought {
  id: number;
  raw_input: string;
  category: string | null;
  status: string;
}

/** Normalize text for fuzzy matching: lowercase, strip punctuation, collapse whitespace */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/^(to do[,:]?\s*|todo[,:]?\s*)/i, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Find an existing thought in Hopper by fuzzy text match */
function findExistingThought(taskText: string): ExistingThought | null {
  const thoughts = db
    .prepare("SELECT id, raw_input, category, status FROM thoughts WHERE category = 'todo'")
    .all() as ExistingThought[];

  const needle = normalize(taskText);
  for (const t of thoughts) {
    const hay = normalize(t.raw_input);
    // Match if one contains the other (handles prefix differences like "To do, pick up...")
    if (hay.includes(needle) || needle.includes(hay)) {
      return t;
    }
  }
  return null;
}

/** Find or create a thought for the given task text. Returns thought_id. */
function upsertThought(taskText: string): number {
  const existing = findExistingThought(taskText);
  if (existing) {
    console.log(`  → matched thought #${existing.id}: "${existing.raw_input}"`);
    return existing.id;
  }

  const result = db
    .prepare(
      "INSERT INTO thoughts (raw_input, category, status, processed_at) VALUES (?, 'todo', 'processed', datetime('now')) RETURNING id"
    )
    .get(taskText) as { id: number };

  console.log(`  → created thought #${result.id}: "${taskText}"`);
  return result.id;
}

// ── Parse Obsidian vault for any todos not already in Hopper ─────────────────

function extractObsidianTodos(): string[] {
  const now = new Date();
  const year = now.getFullYear();
  // Try current and surrounding weeks
  const weekNums = [8, 9, 10];
  const todos: string[] = [];

  for (const w of weekNums) {
    const title = `${year} Week ${String(w).padStart(2, '0')}`;
    const filePath = path.join(VAULT_PATH, `${title}.md`);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      const match = line.match(/- \[[ x]\] (.+)/i);
      if (match) {
        const text = match[1].trim();
        // Strip markdown links [[...]] → just the label
        const cleaned = text.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1');
        todos.push(cleaned);
      }
    }
  }

  return [...new Set(todos)];
}

// ── Migrate weekly plan JSON files ───────────────────────────────────────────

interface PlanTask {
  text: string;
  source: string;
  completed: boolean;
}

interface PlanDay {
  focus: string;
  tasks: PlanTask[];
}

interface WeeklyPlanFile {
  week: string;
  interviewedAt: string;
  weeklyGoals: string[];
  days: Record<string, PlanDay>;
  unscheduled: string[];
  dropped: string[];
}

function migratePlanFile(planPath: string): void {
  const plan: WeeklyPlanFile = JSON.parse(fs.readFileSync(planPath, 'utf-8'));
  console.log(`\nMigrating plan: ${plan.week}`);

  // Skip if already migrated
  const existing = db
    .prepare('SELECT id FROM svc_weekly_review_plans WHERE week = ?')
    .get(plan.week);
  if (existing) {
    console.log(`  → already in DB, skipping`);
    return;
  }

  const planRow = db
    .prepare(
      'INSERT INTO svc_weekly_review_plans (week, weekly_goals, interviewed_at) VALUES (?, ?, ?) RETURNING id'
    )
    .get(plan.week, JSON.stringify(plan.weeklyGoals), plan.interviewedAt) as { id: number };

  const planId = planRow.id;
  console.log(`  → created plan #${planId}`);

  // Scheduled tasks
  for (const [date, day] of Object.entries(plan.days)) {
    for (let i = 0; i < day.tasks.length; i++) {
      const task = day.tasks[i];
      console.log(`\n  Task [${date}]: "${task.text}"`);
      const thoughtId = upsertThought(task.text);

      db.prepare(`
        INSERT INTO svc_weekly_review_tasks
          (plan_id, thought_id, scheduled_date, day_focus, task_text, sort_order, completed, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        planId,
        thoughtId,
        date,
        day.focus,
        task.text,
        i,
        task.completed ? 1 : 0,
        task.completed ? plan.interviewedAt : null
      );
    }
  }

  // Unscheduled items
  for (const text of plan.unscheduled) {
    console.log(`\n  Unscheduled: "${text}"`);
    const thoughtId = upsertThought(text);
    db.prepare(`
      INSERT INTO svc_weekly_review_deferred (plan_id, thought_id, task_text, status)
      VALUES (?, ?, ?, 'unscheduled')
    `).run(planId, thoughtId, text);
  }

  // Dropped items
  for (const text of plan.dropped) {
    console.log(`\n  Dropped: "${text}"`);
    const thoughtId = upsertThought(text);
    db.prepare(`
      INSERT INTO svc_weekly_review_deferred (plan_id, thought_id, task_text, status)
      VALUES (?, ?, ?, 'dropped')
    `).run(planId, thoughtId, text);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log('=== Hopper Migration ===\n');

// 1. Migrate all plan JSON files
const planFiles = fs.readdirSync(PLANS_PATH).filter(f => f.endsWith('.json'));
for (const file of planFiles) {
  migratePlanFile(path.join(PLANS_PATH, file));
}

// 2. Import Obsidian todos not yet in Hopper
console.log('\n=== Obsidian vault todos ===');
if (fs.existsSync(VAULT_PATH)) {
  const vaultTodos = extractObsidianTodos();
  console.log(`Found ${vaultTodos.length} checkbox items in vault`);
  for (const text of vaultTodos) {
    const existing = findExistingThought(text);
    if (!existing) {
      const result = db
        .prepare(
          "INSERT INTO thoughts (raw_input, category, status, processed_at) VALUES (?, 'todo', 'processed', datetime('now')) RETURNING id"
        )
        .get(text) as { id: number };
      console.log(`  → imported from vault #${result.id}: "${text}"`);
    } else {
      console.log(`  → already exists #${existing.id}: "${text}"`);
    }
  }
} else {
  console.log('  Vault path not accessible, skipping');
}

// 3. Summary
const thoughtCount = (db.prepare("SELECT COUNT(*) as c FROM thoughts WHERE category = 'todo'").get() as { c: number }).c;
const planCount = (db.prepare('SELECT COUNT(*) as c FROM svc_weekly_review_plans').get() as { c: number }).c;
const taskCount = (db.prepare('SELECT COUNT(*) as c FROM svc_weekly_review_tasks').get() as { c: number }).c;
const deferredCount = (db.prepare('SELECT COUNT(*) as c FROM svc_weekly_review_deferred').get() as { c: number }).c;

console.log('\n=== Summary ===');
console.log(`  thoughts (category=todo): ${thoughtCount}`);
console.log(`  svc_weekly_review_plans:  ${planCount}`);
console.log(`  svc_weekly_review_tasks:  ${taskCount}`);
console.log(`  svc_weekly_review_deferred: ${deferredCount}`);
console.log('\nDone.');
