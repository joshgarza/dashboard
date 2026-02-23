import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { errorHandler } from '../src/middleware/errorHandler.js';

const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockWriteFileSync = jest.fn();
const mockMkdirSync = jest.fn();

jest.unstable_mockModule('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
}));

const { weeklyReviewRouter } = await import('../src/routes/weeklyReview.js');

const app = express();
app.use(express.json());
app.use('/api', weeklyReviewRouter);
app.use(errorHandler);

// Helper to build a weekly plan JSON
function buildPlan(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const today = `${year}-${month}-${day}`;

  return JSON.stringify({
    week: '2026-W08',
    interviewedAt: '2026-02-23T10:30:00Z',
    weeklyGoals: ['Clear admin backlog', 'Claude tooling setup'],
    days: {
      [today]: {
        focus: 'Admin catch-up day',
        tasks: [
          { text: 'Print POD permits', source: '- [ ] Print POD permits', completed: false },
          { text: 'Follow up with Nathan', source: '- [ ] Follow up with Nathan', completed: false },
          { text: 'Message Christina', source: '- [ ] Message Christina', completed: true },
        ],
      },
    },
    unscheduled: ['Clean garage'],
    dropped: ['Old task'],
    ...overrides,
  });
}

describe('Weekly Review API', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('GET /api/weekly-review/status', () => {
    it('returns needed: true when no plan exists for current week', async () => {
      mockExistsSync.mockReturnValue(false);

      const response = await request(app).get('/api/weekly-review/status');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.needed).toBe(true);
      expect(response.body.data.week).toMatch(/^\d{4}-W\d{2}$/);
    });

    it('returns needed: false when plan exists', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(buildPlan());

      const response = await request(app).get('/api/weekly-review/status');

      expect(response.status).toBe(200);
      expect(response.body.data.needed).toBe(false);
    });
  });

  describe('GET /api/weekly-review/today', () => {
    it("returns correct day's tasks from weekly plan", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(buildPlan());

      const response = await request(app).get('/api/weekly-review/today');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.plan).not.toBeNull();
      expect(response.body.data.plan.focus).toBe('Admin catch-up day');
      expect(response.body.data.plan.tasks).toHaveLength(3);
    });

    it('returns null when no plan exists', async () => {
      mockExistsSync.mockReturnValue(false);

      const response = await request(app).get('/api/weekly-review/today');

      expect(response.status).toBe(200);
      expect(response.body.data.plan).toBeNull();
    });

    it('returns weekly goals alongside today plan', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(buildPlan());

      const response = await request(app).get('/api/weekly-review/today');

      expect(response.body.data.goals).toEqual(['Clear admin backlog', 'Claude tooling setup']);
    });
  });

  describe('POST /api/weekly-review/today/:index/toggle', () => {
    it('flips completion status in plan JSON', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(buildPlan());

      const response = await request(app).post('/api/weekly-review/today/0/toggle');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.completed).toBe(true);
      expect(mockWriteFileSync).toHaveBeenCalled();
    });

    it('toggles completed task back to incomplete', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(buildPlan());

      // Task at index 2 is completed: true
      const response = await request(app).post('/api/weekly-review/today/2/toggle');

      expect(response.status).toBe(200);
      expect(response.body.data.completed).toBe(false);
    });

    it('returns 400 for invalid task index', async () => {
      const response = await request(app).post('/api/weekly-review/today/abc/toggle');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('syncs checkbox back to Obsidian weekly note', async () => {
      const noteContent = '## Todo\n- [ ] Print POD permits\n- [ ] Follow up with Nathan\n- [x] Message Christina\n';
      mockExistsSync.mockReturnValue(true);
      // First call reads the plan, subsequent calls read the Obsidian note
      mockReadFileSync
        .mockReturnValueOnce(buildPlan())
        .mockReturnValueOnce(noteContent)
        .mockReturnValue(buildPlan());

      await request(app).post('/api/weekly-review/today/0/toggle');

      // Should have written to the weekly note with updated checkbox
      const writeCalls = mockWriteFileSync.mock.calls;
      const noteWrite = writeCalls.find(
        (call) => typeof call[1] === 'string' && call[1].includes('- [x] Print POD permits')
      );
      expect(noteWrite).toBeDefined();
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
