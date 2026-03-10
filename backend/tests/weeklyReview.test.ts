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

describe('Weekly Review API', () => {
  beforeEach(() => {
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
