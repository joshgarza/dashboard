import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import Database from 'better-sqlite3';
import { errorHandler } from '../src/middleware/errorHandler.js';

// In-memory DB for tests
const db = new Database(':memory:');
db.pragma('foreign_keys = ON');

// Create minimal thoughts table (referenced by FKs in weekly review schema)
db.exec(`
  CREATE TABLE thoughts (
    id INTEGER PRIMARY KEY,
    raw_input TEXT,
    category TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

jest.unstable_mockModule('../src/services/hopperDb.js', () => ({
  getHopperDb: () => db,
}));

// fs mock for learning-profile.yaml reads
jest.unstable_mockModule('fs', () => ({
  existsSync: () => false,
  readFileSync: () => '',
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  promises: {
    mkdtemp: jest.fn(),
    writeFile: jest.fn(),
    rm: jest.fn(),
  },
}));

const { weeklyReviewRouter } = await import('../src/routes/weeklyReview.js');

const app = express();
app.use(express.json());
app.use('/api', weeklyReviewRouter);
app.use(errorHandler);

// Replicate the service's Pacific-time date helpers for test data setup
function getTestNowInPT(): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const year = parseInt(parts.find(p => p.type === 'year')!.value);
  const month = parseInt(parts.find(p => p.type === 'month')!.value);
  const day = parseInt(parts.find(p => p.type === 'day')!.value);
  return new Date(year, month - 1, day);
}

function getTestWeekString(): string {
  const d = getTestNowInPT();
  const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function getTestPreviousWeekString(): string {
  const d = getTestNowInPT();
  d.setDate(d.getDate() - 7);
  const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function getTestTodayString(): string {
  const d = getTestNowInPT();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function insertPlan(week: string, goals: string[] = ['Goal A', 'Goal B']): { id: number } {
  db.prepare(
    'INSERT INTO svc_weekly_review_plans (week, weekly_goals, interviewed_at) VALUES (?, ?, ?)'
  ).run(week, JSON.stringify(goals), new Date().toISOString());
  return db.prepare('SELECT id FROM svc_weekly_review_plans WHERE week = ?').get(week) as { id: number };
}

function insertTask(planId: number, date: string, text: string, order: number, completed = false, focus = 'Test focus') {
  db.prepare(
    'INSERT INTO svc_weekly_review_tasks (plan_id, scheduled_date, day_focus, task_text, sort_order, completed) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(planId, date, focus, text, order, completed ? 1 : 0);
}

function insertReviewSnapshot({
  week,
  interviewedAt,
  weeklyGoals = ['Goal A'],
  days = {},
  unscheduled = [],
  dropped = [],
}: {
  week: string;
  interviewedAt: string;
  weeklyGoals?: string[];
  days?: Record<string, { focus: string; tasks: Array<{ text: string; thought_id: number | null; completed: boolean }> }>;
  unscheduled?: string[];
  dropped?: string[];
}): number {
  const plan = {
    week,
    interviewedAt,
    weeklyGoals,
    days,
    unscheduled,
    dropped,
  };

  const result = db.prepare(
    'INSERT INTO svc_weekly_review_review_snapshots (week, interviewed_at, plan_json) VALUES (?, ?, ?)'
  ).run(week, interviewedAt, JSON.stringify(plan));

  return Number(result.lastInsertRowid);
}

describe('Weekly Review API', () => {
  beforeEach(() => {
    db.exec('DELETE FROM svc_weekly_review_review_snapshots');
    db.exec('DELETE FROM svc_weekly_review_deferred');
    db.exec('DELETE FROM svc_weekly_review_tasks');
    db.exec('DELETE FROM svc_weekly_review_plans');
  });

  describe('GET /api/weekly-review/status', () => {
    it('returns needed: true when no plan exists for current week', async () => {
      const response = await request(app).get('/api/weekly-review/status');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.needed).toBe(true);
      expect(response.body.data.week).toMatch(/^\d{4}-W\d{2}$/);
    });

    it('returns needed: false when plan exists', async () => {
      insertPlan(getTestWeekString());

      const response = await request(app).get('/api/weekly-review/status');

      expect(response.status).toBe(200);
      expect(response.body.data.needed).toBe(false);
    });
  });

  describe('GET /api/weekly-review/today', () => {
    it("returns correct day's tasks from weekly plan", async () => {
      const week = getTestWeekString();
      const today = getTestTodayString();
      const plan = insertPlan(week, ['Clear admin backlog', 'Claude tooling setup']);
      insertTask(plan.id, today, 'Print POD permits', 0, false, 'Admin catch-up day');
      insertTask(plan.id, today, 'Follow up with Nathan', 1, false, 'Admin catch-up day');
      insertTask(plan.id, today, 'Message Christina', 2, true, 'Admin catch-up day');

      const response = await request(app).get('/api/weekly-review/today');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.plan).not.toBeNull();
      expect(response.body.data.plan.focus).toBe('Admin catch-up day');
      expect(response.body.data.plan.tasks).toHaveLength(3);
    });

    it('returns null when no plan exists', async () => {
      const response = await request(app).get('/api/weekly-review/today');

      expect(response.status).toBe(200);
      expect(response.body.data.plan).toBeNull();
    });

    it('returns weekly goals alongside today plan', async () => {
      const week = getTestWeekString();
      const today = getTestTodayString();
      const plan = insertPlan(week, ['Clear admin backlog', 'Claude tooling setup']);
      insertTask(plan.id, today, 'Some task', 0);

      const response = await request(app).get('/api/weekly-review/today');

      expect(response.body.data.goals).toEqual(['Clear admin backlog', 'Claude tooling setup']);
    });
  });

  describe('POST /api/weekly-review/today/:index/toggle', () => {
    it('flips completion status in DB', async () => {
      const week = getTestWeekString();
      const today = getTestTodayString();
      const plan = insertPlan(week);
      insertTask(plan.id, today, 'Print POD permits', 0, false);
      insertTask(plan.id, today, 'Follow up with Nathan', 1, false);
      insertTask(plan.id, today, 'Message Christina', 2, true);

      const response = await request(app).post('/api/weekly-review/today/0/toggle');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.completed).toBe(true);
    });

    it('toggles completed task back to incomplete', async () => {
      const week = getTestWeekString();
      const today = getTestTodayString();
      const plan = insertPlan(week);
      insertTask(plan.id, today, 'Print POD permits', 0, false);
      insertTask(plan.id, today, 'Follow up with Nathan', 1, false);
      insertTask(plan.id, today, 'Message Christina', 2, true);

      const response = await request(app).post('/api/weekly-review/today/2/toggle');

      expect(response.status).toBe(200);
      expect(response.body.data.completed).toBe(false);
    });

    it('returns 400 for invalid task index', async () => {
      const response = await request(app).post('/api/weekly-review/today/abc/toggle');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/weekly-review/reviews', () => {
    it('returns all saved reviews in reverse chronological order, including multiple in the same week', async () => {
      const week = getTestWeekString();
      const olderId = insertReviewSnapshot({
        week,
        interviewedAt: '2026-03-09T08:00:00.000Z',
        weeklyGoals: ['Older review'],
        days: {
          '2026-03-09': {
            focus: 'Focus older',
            tasks: [{ text: 'Older task', thought_id: null, completed: false }],
          },
        },
      });
      const newerId = insertReviewSnapshot({
        week,
        interviewedAt: '2026-03-10T12:30:00.000Z',
        weeklyGoals: ['Latest review'],
        days: {
          '2026-03-10': {
            focus: 'Focus newer',
            tasks: [
              { text: 'Newer task 1', thought_id: null, completed: false },
              { text: 'Newer task 2', thought_id: null, completed: false },
            ],
          },
        },
      });

      const response = await request(app).get('/api/weekly-review/reviews');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([
        expect.objectContaining({
          id: newerId,
          week,
          interviewedAt: '2026-03-10T12:30:00.000Z',
          weeklyGoals: ['Latest review'],
          dayCount: 1,
          taskCount: 2,
          completionSummary: null,
        }),
        expect.objectContaining({
          id: olderId,
          week,
          interviewedAt: '2026-03-09T08:00:00.000Z',
          weeklyGoals: ['Older review'],
          dayCount: 1,
          taskCount: 1,
          completionSummary: null,
        }),
      ]);
    });

    it('includes completion summary for past weeks', async () => {
      const pastWeek = getTestPreviousWeekString();
      const plan = insertPlan(pastWeek, ['Past goal']);
      insertTask(plan.id, '2026-03-03', 'Completed task', 0, true, 'Past focus');
      insertTask(plan.id, '2026-03-04', 'Missed task', 1, false, 'Past focus');

      const reviewId = insertReviewSnapshot({
        week: pastWeek,
        interviewedAt: '2026-03-04T18:00:00.000Z',
        weeklyGoals: ['Past goal'],
        days: {
          '2026-03-03': {
            focus: 'Past focus',
            tasks: [
              { text: 'Completed task', thought_id: null, completed: false },
              { text: 'Missed task', thought_id: null, completed: false },
            ],
          },
        },
      });

      const response = await request(app).get('/api/weekly-review/reviews');

      expect(response.status).toBe(200);
      expect(response.body.data).toContainEqual(expect.objectContaining({
        id: reviewId,
        completionSummary: {
          completedCount: 1,
          assignedCount: 2,
        },
      }));
    });
  });

  describe('GET /api/weekly-review/reviews/:id', () => {
    it('returns the selected saved review', async () => {
      const reviewId = insertReviewSnapshot({
        week: '2026-W11',
        interviewedAt: '2026-03-10T12:30:00.000Z',
        weeklyGoals: ['Ship weekly review UI'],
        days: {
          '2026-03-10': {
            focus: 'Frontend',
            tasks: [{ text: 'Implement sidebar', thought_id: 42, completed: false }],
          },
        },
        unscheduled: ['Polish animations'],
      });

      const response = await request(app).get(`/api/weekly-review/reviews/${reviewId}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(expect.objectContaining({
        id: reviewId,
        week: '2026-W11',
        weeklyGoals: ['Ship weekly review UI'],
        taskCount: 1,
        completionSummary: null,
        plan: expect.objectContaining({
          unscheduled: ['Polish animations'],
        }),
      }));
    });
  });

  describe('POST /api/weekly-review/interview', () => {
    it('returns 400 when messages is missing', async () => {
      const response = await request(app)
        .post('/api/weekly-review/interview')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/weekly-review/finalize', () => {
    it('returns 400 when messages is missing', async () => {
      const response = await request(app)
        .post('/api/weekly-review/finalize')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });
});
