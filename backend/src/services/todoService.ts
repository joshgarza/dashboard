import { getHopperDb } from './hopperDb.js';
import { initWeeklyReviewSchema } from './hopperSchema.js';

initWeeklyReviewSchema();

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getCurrentWeekString(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parseInt(parts.find(p => p.type === 'year')!.value);
  const month = parseInt(parts.find(p => p.type === 'month')!.value);
  const day = parseInt(parts.find(p => p.type === 'day')!.value);
  const ptDate = new Date(year, month - 1, day);
  const week = getISOWeek(ptDate);
  return `${ptDate.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

export interface TodoItem {
  id: number;
  text: string;
  completed: boolean;
  completed_at: string | null;
  source: string | null;
}

export function completeTodo(thoughtId: number, source: 'manual' | 'agent' = 'manual'): boolean {
  const db = getHopperDb();

  // Verify thought exists with category='todo'
  const thought = db
    .prepare("SELECT id FROM thoughts WHERE id = ? AND category = 'todo'")
    .get(thoughtId) as { id: number } | undefined;

  if (!thought) return false;

  db.prepare(`
    INSERT OR IGNORE INTO svc_dashboard_completions (thought_id, completed_at, source)
    VALUES (?, datetime('now'), ?)
  `).run(thoughtId, source);

  // Also mark matching svc_weekly_review_tasks rows as completed (cross-system consistency)
  const week = getCurrentWeekString();
  db.prepare(`
    UPDATE svc_weekly_review_tasks
    SET completed = 1, completed_at = datetime('now')
    WHERE thought_id = ?
      AND completed = 0
      AND plan_id IN (
        SELECT id FROM svc_weekly_review_plans WHERE week = ?
      )
  `).run(thoughtId, week);

  return true;
}

export function uncompleteTodo(thoughtId: number): void {
  const db = getHopperDb();
  db.prepare('DELETE FROM svc_dashboard_completions WHERE thought_id = ?').run(thoughtId);
}

export function listAllTodos(): TodoItem[] {
  const db = getHopperDb();

  interface Row {
    id: number;
    raw_input: string;
    completed: number;
    completed_at: string | null;
    source: string | null;
  }

  // Active todos (not dropped, not completed in svc_dashboard_completions)
  const active = db.prepare(`
    SELECT t.id, t.raw_input, 0 AS completed, NULL AS completed_at, NULL AS source
    FROM thoughts t
    WHERE t.category = 'todo'
      AND t.id NOT IN (
        SELECT d.thought_id FROM svc_weekly_review_deferred d
        WHERE d.status = 'dropped' AND d.thought_id IS NOT NULL
      )
      AND t.id NOT IN (
        SELECT dc.thought_id FROM svc_dashboard_completions dc
      )
    ORDER BY t.created_at ASC
  `).all() as Row[];

  // Recently completed (last 7 days)
  const recentlyCompleted = db.prepare(`
    SELECT t.id, t.raw_input, 1 AS completed, dc.completed_at, dc.source
    FROM svc_dashboard_completions dc
    JOIN thoughts t ON t.id = dc.thought_id
    WHERE dc.completed_at >= datetime('now', '-7 days')
    ORDER BY dc.completed_at DESC
  `).all() as Row[];

  return [
    ...active.map(r => ({ id: r.id, text: r.raw_input, completed: false, completed_at: null, source: null })),
    ...recentlyCompleted.map(r => ({ id: r.id, text: r.raw_input, completed: true, completed_at: r.completed_at, source: r.source })),
  ];
}
