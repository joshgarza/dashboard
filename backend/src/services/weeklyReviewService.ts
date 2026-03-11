import * as fs from 'fs';
import * as path from 'path';
import type { Response } from 'express';
import { getHopperDb } from './hopperDb.js';
import { initWeeklyReviewSchema } from './hopperSchema.js';
import { completeTodo } from './todoService.js';
import { runCodexStructuredTask, runCodexTextTask, streamCodexTurn } from './codexProvider.js';
import { sessionManager } from './sessionManager.js';
import type {
  FinalizedWeeklyReview,
  WeeklyPlan,
  WeeklyReviewCompletionSummary,
  WeeklyReviewRecord,
  WeeklyReviewSummary,
  DailyPlan,
  DailyTask,
  ChatMessage,
  InterviewStatus,
  WeeklyContext,
} from '../types/weeklyReview.js';

const PROFILE_PATH = path.resolve(import.meta.dirname, '../../data/learning-profile.yaml');

// ── Init ─────────────────────────────────────────────────────────────────────

initWeeklyReviewSchema();

// ── Date helpers ─────────────────────────────────────────────────────────────

function getNowInPT(): Date {
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
  return new Date(year, month - 1, day);
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getCurrentWeekString(): string {
  const now = getNowInPT();
  const week = getISOWeek(now);
  return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function getWeekStringForDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0);
  const week = getISOWeek(date);
  return `${date.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function getPreviousWeekString(): string {
  const now = getNowInPT();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const week = getISOWeek(weekAgo);
  return `${weekAgo.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function getTodayDateString(): string {
  const now = getNowInPT();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ── DB read helpers ───────────────────────────────────────────────────────────

interface PlanRow {
  id: number;
  week: string;
  weekly_goals: string;
  interviewed_at: string;
}

interface TaskRow {
  id: number;
  plan_id: number;
  thought_id: number | null;
  scheduled_date: string;
  day_focus: string | null;
  task_text: string;
  sort_order: number;
  completed: number;
  completed_at: string | null;
}

interface DeferredRow {
  id: number;
  thought_id: number | null;
  task_text: string;
  status: string;
}

interface ReviewSnapshotRow {
  id: number;
  week: string;
  interviewed_at: string;
  plan_json: string;
}

function parseWeeklyPlan(rawPlan: string): WeeklyPlan {
  return JSON.parse(rawPlan) as WeeklyPlan;
}

function countPlanTasks(plan: WeeklyPlan): number {
  return Object.values(plan.days).reduce((count, day) => count + day.tasks.length, 0);
}

function flattenPlanTasks(plan: WeeklyPlan): DailyTask[] {
  return Object.values(plan.days).flatMap((day) => day.tasks);
}

function decrementCount(map: Map<string, number>, key: string): boolean {
  const count = map.get(key) ?? 0;
  if (count <= 0) {
    return false;
  }

  if (count === 1) {
    map.delete(key);
  } else {
    map.set(key, count - 1);
  }

  return true;
}

function buildCompletionSummary(plan: WeeklyPlan): WeeklyReviewCompletionSummary | null {
  if (plan.week.localeCompare(getCurrentWeekString()) >= 0) {
    return null;
  }

  const activePlan = loadPlanFromDb(plan.week);
  if (!activePlan) {
    return null;
  }

  const completedByThoughtId = new Map<string, number>();
  const completedByText = new Map<string, number>();

  for (const task of flattenPlanTasks(activePlan)) {
    if (!task.completed) {
      continue;
    }

    if (task.thought_id != null) {
      const thoughtKey = String(task.thought_id);
      completedByThoughtId.set(thoughtKey, (completedByThoughtId.get(thoughtKey) ?? 0) + 1);
    }

    completedByText.set(task.text, (completedByText.get(task.text) ?? 0) + 1);
  }

  let completedCount = 0;
  const assignedCount = countPlanTasks(plan);

  for (const task of flattenPlanTasks(plan)) {
    if (task.thought_id != null && decrementCount(completedByThoughtId, String(task.thought_id))) {
      completedCount += 1;
      continue;
    }

    if (decrementCount(completedByText, task.text)) {
      completedCount += 1;
    }
  }

  return {
    completedCount,
    assignedCount,
  };
}

function buildReviewSummary(row: ReviewSnapshotRow, plan: WeeklyPlan): WeeklyReviewSummary {
  return {
    id: row.id,
    week: row.week,
    interviewedAt: row.interviewed_at,
    weeklyGoals: plan.weeklyGoals,
    dayCount: Object.keys(plan.days).length,
    taskCount: countPlanTasks(plan),
    completionSummary: buildCompletionSummary(plan),
  };
}

function loadPlanFromRow(planRow: PlanRow): WeeklyPlan | null {
  const db = getHopperDb();

  const taskRows = db
    .prepare('SELECT * FROM svc_weekly_review_tasks WHERE plan_id = ? ORDER BY scheduled_date, sort_order')
    .all(planRow.id) as TaskRow[];

  const deferredRows = db
    .prepare('SELECT * FROM svc_weekly_review_deferred WHERE plan_id = ?')
    .all(planRow.id) as DeferredRow[];

  const days: Record<string, DailyPlan> = {};
  for (const row of taskRows) {
    if (!days[row.scheduled_date]) {
      days[row.scheduled_date] = { focus: row.day_focus ?? '', tasks: [] };
    }
    days[row.scheduled_date].tasks.push({
      id: row.id,
      thought_id: row.thought_id,
      text: row.task_text,
      completed: row.completed === 1,
    });
  }

  return {
    week: planRow.week,
    interviewedAt: planRow.interviewed_at,
    weeklyGoals: JSON.parse(planRow.weekly_goals),
    days,
    unscheduled: deferredRows.filter((row) => row.status === 'unscheduled').map((row) => row.task_text),
    dropped: deferredRows.filter((row) => row.status === 'dropped').map((row) => row.task_text),
  };
}

function loadActivePlanRow(week: string): PlanRow | null {
  const db = getHopperDb();

  const planRow = db
    .prepare('SELECT * FROM svc_weekly_review_plans WHERE week = ?')
    .get(week) as PlanRow | undefined;

  return planRow ?? null;
}

function loadPlanFromDb(week: string): WeeklyPlan | null {
  const planRow = loadActivePlanRow(week);
  if (!planRow) {
    return null;
  }
  return loadPlanFromRow(planRow);
}

function saveReviewSnapshot(plan: WeeklyPlan): number {
  const db = getHopperDb();
  const result = db.prepare(`
    INSERT INTO svc_weekly_review_review_snapshots (week, interviewed_at, plan_json)
    VALUES (?, ?, ?)
  `).run(plan.week, plan.interviewedAt, JSON.stringify(plan));

  return Number(result.lastInsertRowid);
}

function backfillReviewSnapshots(): void {
  const db = getHopperDb();
  const planRows = db
    .prepare('SELECT * FROM svc_weekly_review_plans ORDER BY interviewed_at DESC, id DESC')
    .all() as PlanRow[];

  for (const planRow of planRows) {
    const existing = db
      .prepare(`
        SELECT 1
        FROM svc_weekly_review_review_snapshots
        WHERE week = ? AND interviewed_at = ?
        LIMIT 1
      `)
      .get(planRow.week, planRow.interviewed_at);

    if (existing) {
      continue;
    }

    const plan = loadPlanFromRow(planRow);
    if (plan) {
      saveReviewSnapshot(plan);
    }
  }
}

backfillReviewSnapshots();

// ── Public API ────────────────────────────────────────────────────────────────

export function getInterviewStatus(): InterviewStatus {
  const week = getCurrentWeekString();
  const plan = loadPlanFromDb(week);
  return {
    needed: plan === null,
    week,
  };
}

export function getTodayPlan(): DailyPlan | null {
  const week = getCurrentWeekString();
  const plan = loadPlanFromDb(week);
  if (!plan) return null;

  const today = getTodayDateString();
  return plan.days[today] || null;
}

export function getWeeklyGoals(): string[] {
  const week = getCurrentWeekString();
  const plan = loadPlanFromDb(week);
  if (!plan) return [];
  return plan.weeklyGoals;
}

export function getPlanForDate(dateStr: string): DailyPlan | null {
  const week = getWeekStringForDate(dateStr);
  const plan = loadPlanFromDb(week);
  if (!plan) return null;
  return plan.days[dateStr] || null;
}

export function getWeeklyGoalsForDate(dateStr: string): string[] {
  const week = getWeekStringForDate(dateStr);
  const plan = loadPlanFromDb(week);
  if (!plan) return [];
  return plan.weeklyGoals;
}

export function toggleTask(dateStr: string, taskIndex: number): DailyTask {
  const db = getHopperDb();
  const week = getWeekStringForDate(dateStr);

  const planRow = db
    .prepare('SELECT id FROM svc_weekly_review_plans WHERE week = ?')
    .get(week) as { id: number } | undefined;
  if (!planRow) throw new Error('No weekly plan exists');

  const tasks = db
    .prepare(
      'SELECT * FROM svc_weekly_review_tasks WHERE plan_id = ? AND scheduled_date = ? ORDER BY sort_order'
    )
    .all(planRow.id, dateStr) as TaskRow[];

  const task = tasks[taskIndex];
  if (!task) throw new Error(`No task at index: ${taskIndex}`);

  const newCompleted = task.completed === 0 ? 1 : 0;
  const completedAt = newCompleted === 1 ? new Date().toISOString() : null;

  db.prepare(
    'UPDATE svc_weekly_review_tasks SET completed = ?, completed_at = ? WHERE id = ?'
  ).run(newCompleted, completedAt, task.id);

  return {
    id: task.id,
    thought_id: task.thought_id,
    text: task.task_text,
    completed: newCompleted === 1,
  };
}

export function listSavedReviews(): WeeklyReviewSummary[] {
  const db = getHopperDb();
  const rows = db
    .prepare(`
      SELECT *
      FROM svc_weekly_review_review_snapshots
      ORDER BY interviewed_at DESC, id DESC
    `)
    .all() as ReviewSnapshotRow[];

  return rows.map((row) => {
    const plan = parseWeeklyPlan(row.plan_json);
    return buildReviewSummary(row, plan);
  });
}

export function getSavedReview(reviewId: number): WeeklyReviewRecord | null {
  const db = getHopperDb();
  const row = db
    .prepare('SELECT * FROM svc_weekly_review_review_snapshots WHERE id = ?')
    .get(reviewId) as ReviewSnapshotRow | undefined;

  if (!row) {
    return null;
  }

  const plan = parseWeeklyPlan(row.plan_json);
  return {
    ...buildReviewSummary(row, plan),
    plan,
  };
}

export function getWeeklyContext(): WeeklyContext {
  const db = getHopperDb();

  // All active todos from Hopper (category=todo, not dropped from a plan)
  interface ThoughtRow { id: number; raw_input: string; }
  const pendingTodos = db
    .prepare(`
      SELECT t.id, t.raw_input
      FROM thoughts t
      WHERE t.category = 'todo'
        AND t.id NOT IN (
          SELECT d.thought_id FROM svc_weekly_review_deferred d
          WHERE d.status = 'dropped' AND d.thought_id IS NOT NULL
        )
        AND t.id NOT IN (
          SELECT wrt.thought_id FROM svc_weekly_review_tasks wrt
          WHERE wrt.completed = 1 AND wrt.thought_id IS NOT NULL
        )
        AND t.id NOT IN (
          SELECT dc.thought_id FROM svc_dashboard_completions dc
        )
      ORDER BY t.created_at ASC
    `)
    .all() as ThoughtRow[];

  const currentTodos = pendingTodos
    .map(t => `[${t.id}] ${t.raw_input}`)
    .join('\n');

  // Previous week summary (detailed)
  const prevWeek = getPreviousWeekString();
  const prevPlan = loadPlanFromDb(prevWeek);
  let previousWeekSummary = 'No previous week data available.';
  if (prevPlan) {
    const completedTasks: string[] = [];
    const skippedTasks: string[] = [];
    for (const day of Object.values(prevPlan.days)) {
      for (const task of day.tasks) {
        if (task.completed) completedTasks.push(task.text);
        else skippedTasks.push(task.text);
      }
    }
    const planned = completedTasks.length + skippedTasks.length;
    const pct = planned > 0 ? Math.round((completedTasks.length / planned) * 100) : 0;
    previousWeekSummary = `Week ${prevPlan.week} — ${completedTasks.length}/${planned} tasks completed (${pct}%)
Goals: ${prevPlan.weeklyGoals.join('; ')}
Completed: ${completedTasks.length > 0 ? completedTasks.map(t => `  - ${t}`).join('\n') : '  (none)'}
Skipped/not done: ${skippedTasks.length > 0 ? skippedTasks.map(t => `  - ${t}`).join('\n') : '  (none)'}`;
  }

  // Current week plan (for redo continuity)
  const currWeek = getCurrentWeekString();
  const currPlan = loadPlanFromDb(currWeek);
  let currentWeekContext = '';
  if (currPlan) {
    const doneThisWeek: string[] = [];
    const pendingThisWeek: string[] = [];
    for (const day of Object.values(currPlan.days)) {
      for (const task of day.tasks) {
        if (task.completed) doneThisWeek.push(task.text);
        else pendingThisWeek.push(task.text);
      }
    }
    currentWeekContext = `An existing plan already exists for this week (${currWeek}).
Goals set earlier: ${currPlan.weeklyGoals.join('; ')}
Already completed this week (${doneThisWeek.length}): ${doneThisWeek.length > 0 ? doneThisWeek.map(t => `  - ${t}`).join('\n') : '  (none)'}
Still pending in original plan (${pendingThisWeek.length}): ${pendingThisWeek.length > 0 ? pendingThisWeek.map(t => `  - ${t}`).join('\n') : '  (none)'}`;
  }

  // Learning profile
  let profile = '';
  if (fs.existsSync(PROFILE_PATH)) {
    profile = fs.readFileSync(PROFILE_PATH, 'utf-8');
  }

  return { currentTodos, previousWeekSummary, currentWeekContext, profile };
}

export function savePlan(plan: WeeklyPlan): void {
  const db = getHopperDb();

  // Upsert the plan header
  db.prepare(`
    INSERT INTO svc_weekly_review_plans (week, weekly_goals, interviewed_at)
    VALUES (?, ?, ?)
    ON CONFLICT(week) DO UPDATE SET
      weekly_goals = excluded.weekly_goals,
      interviewed_at = excluded.interviewed_at
  `).run(plan.week, JSON.stringify(plan.weeklyGoals), plan.interviewedAt);

  const planRow = db
    .prepare('SELECT id FROM svc_weekly_review_plans WHERE week = ?')
    .get(plan.week) as { id: number };
  const planId = planRow.id;

  // Capture existing completion state before replacing tasks (for redo continuity)
  interface CompletedRow { thought_id: number | null; task_text: string; completed_at: string; }
  const prevCompleted = db
    .prepare('SELECT thought_id, task_text, completed_at FROM svc_weekly_review_tasks WHERE plan_id = ? AND completed = 1')
    .all(planId) as CompletedRow[];
  const completedByThoughtId = new Map(
    prevCompleted.filter(r => r.thought_id != null).map(r => [r.thought_id!, r.completed_at])
  );
  const completedByText = new Map(prevCompleted.map(r => [r.task_text, r.completed_at]));

  // Replace tasks and deferred for this plan
  db.prepare('DELETE FROM svc_weekly_review_tasks WHERE plan_id = ?').run(planId);
  db.prepare('DELETE FROM svc_weekly_review_deferred WHERE plan_id = ?').run(planId);

  for (const [date, day] of Object.entries(plan.days)) {
    for (let i = 0; i < day.tasks.length; i++) {
      const task = day.tasks[i];
      const prevCompletedAt =
        (task.thought_id != null ? completedByThoughtId.get(task.thought_id) : undefined) ??
        completedByText.get(task.text) ??
        null;
      const isCompleted = prevCompletedAt != null ? 1 : (task.completed ? 1 : 0);
      const completedAt = prevCompletedAt ?? (task.completed ? new Date().toISOString() : null);
      db.prepare(`
        INSERT INTO svc_weekly_review_tasks
          (plan_id, thought_id, scheduled_date, day_focus, task_text, sort_order, completed, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        planId,
        task.thought_id ?? null,
        date,
        day.focus,
        task.text,
        i,
        isCompleted,
        completedAt
      );
    }
  }

  for (const text of plan.unscheduled) {
    db.prepare(`
      INSERT INTO svc_weekly_review_deferred (plan_id, thought_id, task_text, status)
      VALUES (?, ?, ?, 'unscheduled')
    `).run(planId, null, text);
  }

  for (const text of plan.dropped) {
    db.prepare(`
      INSERT INTO svc_weekly_review_deferred (plan_id, thought_id, task_text, status)
      VALUES (?, ?, ?, 'dropped')
    `).run(planId, null, text);
  }
}

export function updateProfile(updates: string): void {
  fs.writeFileSync(PROFILE_PATH, updates);
}

export function updateProfileAfterReview(messages: ChatMessage[], plan: WeeklyPlan): void {
  const currentProfile = fs.existsSync(PROFILE_PATH) ? fs.readFileSync(PROFILE_PATH, 'utf-8') : '';

  // Build last-week completion stats for the prompt
  const prevWeek = getPreviousWeekString();
  const prevPlan = loadPlanFromDb(prevWeek);
  let completionStats = 'No previous week data.';
  if (prevPlan) {
    const completedTasks: string[] = [];
    const skippedTasks: string[] = [];
    for (const day of Object.values(prevPlan.days)) {
      for (const task of day.tasks) {
        if (task.completed) completedTasks.push(task.text);
        else skippedTasks.push(task.text);
      }
    }
    const planned = completedTasks.length + skippedTasks.length;
    const pct = planned > 0 ? Math.round((completedTasks.length / planned) * 100) : 0;
    completionStats = `Week ${prevPlan.week}: ${completedTasks.length}/${planned} (${pct}%)
Completed: ${completedTasks.join(', ') || 'none'}
Skipped: ${skippedTasks.join(', ') || 'none'}`;
  }

  const conversationText = messages
    .map(m => (m.role === 'user' ? `Human: ${m.content}` : `Assistant: ${m.content}`))
    .join('\n\n');

  const prompt = `You are a productivity analyst updating a user's learning profile after their weekly review session.

Current profile (YAML):
${currentProfile}

Weekly review conversation:
${conversationText}

Last week's completion data:
${completionStats}

This week's goals: ${plan.weeklyGoals.join('; ')}

Update the profile YAML based on evidence from this conversation. You MUST:
- Update avg_weekly_completion with the latest completion rate (rolling — weight recent weeks more)
- Update commonly_deferred with task types/themes that keep getting skipped (infer from skipped tasks and conversation)
- Update commonly_completed_first with task types the user reliably finishes
- Update energy_patterns.notes with any patterns observed about when/how the user works best
- Append one entry to review_history: { week: "${plan.week}", planned: <N>, completed: <N>, notes: "<one-line observation>" }

Return ONLY valid YAML with the exact same top-level structure as the current profile. No explanation, no markdown fences.`;

  void (async () => {
    try {
      let yaml = await runCodexTextTask(prompt);
      yaml = yaml.replace(/^```(?:yaml)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
      if (yaml) updateProfile(yaml);
    } catch (err) {
      console.error('[profile-update] codex failed:', (err as Error).message);
    }
  })();
}

// ── Agent prompts ─────────────────────────────────────────────────────────────

const INTERVIEW_SYSTEM_PROMPT = `You are a weekly planning assistant helping the user organize their todo list into daily plans. You conduct a brief, focused interview (~5-10 minutes).

## Interview Flow
1. Retrospective: Open by presenting your analysis of last week — what was accomplished, what was skipped, and how well the completed work aligned with the goals that were set. Ask if this matches their experience or if there's context you're missing. Do NOT ask them to recall what happened; you have the data.
2. Weekly goals: Ask "What are your goals this week?" — these become the lens for all prioritization decisions.
3. Triage: Walk through this week's items. For recurring deferrals, ask: keep, reschedule, or drop? Use weekly goals to guide which items matter most.
4. Daily distribution: Propose tasks for each remaining day this week, organized around the weekly goals.
5. Calibration: Does this daily breakdown feel realistic?

## Redo behavior
If an existing plan is provided for this week, open by acknowledging it: note what's already been completed, what's still pending, and ask what prompted the redo (goals changed, plan needs adjustment, etc.). Preserve already-completed tasks in the new plan.

## Rules
- Do NOT ask the user to tag, categorize, or estimate durations for tasks
- Infer task types and priorities from context and conversation
- Use the weekly goals as the primary organizing principle — tasks that advance the goals should be prioritized
- Keep the interview conversational and efficient
- Learn from what the user tells you — note patterns for the profile
- When proposing the daily plan, explain your reasoning briefly

## Actions
When you and the user agree that a todo is complete, emit an action tag on its own line:
<action type="complete_todo" thought_id="42" />
The system processes this automatically and removes it from visible output.
Only use IDs from the provided todo list. Do not fabricate IDs.`;

const ACTION_TAG_RE = /<action\s+type="complete_todo"\s+thought_id="(\d+)"\s*\/>/g;

function stripActionTags(text: string): string {
  return text.replace(ACTION_TAG_RE, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function executeActions(fullText: string): void {
  let match: RegExpExecArray | null;
  const re = new RegExp(ACTION_TAG_RE.source, 'g');
  while ((match = re.exec(fullText)) !== null) {
    const thoughtId = parseInt(match[1], 10);
    if (!isNaN(thoughtId)) {
      const found = completeTodo(thoughtId, 'agent');
      if (found) {
        console.log(`[interview] agent completed todo ${thoughtId}`);
      } else {
        console.warn(`[interview] agent tried to complete unknown todo ${thoughtId}`);
      }
    }
  }
}

function getLatestUserMessage(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return messages[i].content;
    }
  }
  throw new Error('No user message found');
}

function buildInterviewPrompt(messages: ChatMessage[], hasActiveSession: boolean): string {
  const context = getWeeklyContext();
  const systemBlock = `${INTERVIEW_SYSTEM_PROMPT}

## User Profile
${context.profile}

## Current Todo List (ID: text)
${context.currentTodos}

## Last Week's Results
${context.previousWeekSummary}${context.currentWeekContext ? `\n\n## This Week's Existing Plan (Redo)\n${context.currentWeekContext}` : ''}`;

  if (hasActiveSession) {
    const latestUserMessage = getLatestUserMessage(messages);
    return `${systemBlock}\n\nContinue the ongoing weekly review. The user's latest message is:\nHuman: ${latestUserMessage}`;
  }

  const conversationLines = messages.map(m =>
    m.role === 'user' ? `Human: ${m.content}` : `Assistant: ${m.content}`
  );

  return `${systemBlock}\n\n${conversationLines.join('\n\n')}`;
}

export function streamInterview(
  messages: ChatMessage[],
  sessionId: string | null,
  res: Response,
): Promise<void> {
  const hasActiveSession = !!(sessionId && sessionManager.get(sessionId, 'weekly-review'));
  const prompt = buildInterviewPrompt(messages, hasActiveSession);

  return streamCodexTurn({
    kind: 'weekly-review',
    sessionId,
    input: prompt,
    response: res,
    transformText: stripActionTags,
    onComplete: (fullResponseText) => {
      if (fullResponseText) {
        executeActions(fullResponseText);
      }
    },
  });
}

const FINALIZE_SYSTEM_PROMPT = `You are a weekly planning assistant. Based on the conversation below, generate a structured weekly plan as JSON.

You MUST respond with ONLY valid JSON — no markdown, no explanation, no code fences. Just the raw JSON object.

The JSON must match this exact schema:
{
  "weeklyGoals": ["goal 1", "goal 2"],
  "days": {
    "YYYY-MM-DD": {
      "focus": "Focus area for this day",
      "tasks": [
        {
          "text": "Human-readable task description",
          "thought_id": 42,
          "completed": false
        }
      ]
    }
  },
  "unscheduled": ["task texts intentionally deferred"],
  "dropped": ["task texts the user decided to drop"]
}

Rules:
- Only include days from today through the rest of the week (Monday-Sunday)
- The "thought_id" field must be the integer ID from the todo list provided (e.g. 42 for "[42] Some task"). Use null if the task was not in the provided list.
- Set completed to false for all tasks
- Keep max 5 tasks per day unless the user specifically requested more
- Respect any preferences expressed in the conversation`;

const WEEKLY_PLAN_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    weeklyGoals: {
      type: 'array',
      items: { type: 'string' },
    },
    days: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          focus: { type: 'string' },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                thought_id: {
                  anyOf: [
                    { type: 'integer' },
                    { type: 'null' },
                  ],
                },
                completed: { type: 'boolean' },
              },
              required: ['text', 'thought_id', 'completed'],
              additionalProperties: false,
            },
          },
        },
        required: ['focus', 'tasks'],
        additionalProperties: false,
      },
    },
    unscheduled: {
      type: 'array',
      items: { type: 'string' },
    },
    dropped: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['weeklyGoals', 'days', 'unscheduled', 'dropped'],
  additionalProperties: false,
} as const;

export function generatePlan(
  messages: ChatMessage[],
): Promise<FinalizedWeeklyReview> {
  return (async () => {
    const context = getWeeklyContext();
    const week = getCurrentWeekString();

    const conversationText = messages.map(m =>
      m.role === 'user' ? `Human: ${m.content}` : `Assistant: ${m.content}`
    ).join('\n\n');

    const prompt = `${FINALIZE_SYSTEM_PROMPT}

## Current Todo List (ID: text)
${context.currentTodos}

## Conversation
${conversationText}

Today's date is ${getTodayDateString()}. The current week is ${week}.

Generate the JSON plan now:`;

    const text = await runCodexStructuredTask(prompt, WEEKLY_PLAN_OUTPUT_SCHEMA);
    const planData = JSON.parse(text);

    const plan: WeeklyPlan = {
      week,
      interviewedAt: new Date().toISOString(),
      weeklyGoals: planData.weeklyGoals || [],
      days: planData.days || {},
      unscheduled: planData.unscheduled || [],
      dropped: planData.dropped || [],
    };

    savePlan(plan);
    const reviewId = saveReviewSnapshot(plan);

    return {
      reviewId,
      plan,
    };
  })();
}
