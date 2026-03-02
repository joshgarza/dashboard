import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { errorHandler } from '../src/middleware/errorHandler.js';

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
globalThis.fetch = mockFetch;

const { crmRouter } = await import('../src/routes/crm.js');

const app = express();
app.use(express.json());
app.use('/api', crmRouter);
app.use(errorHandler);

describe('CRM API', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = {
      ...originalEnv,
      ESPO_URL: 'http://localhost:8080',
      ESPO_USER: 'testuser',
      ESPO_PASS: 'testpass',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('GET /api/crm/contacts', () => {
    it('returns contacts grouped by cStatus with imminentFollowUps', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          total: 5,
          list: [
            { id: '1', name: 'Contact A', cStatus: 'Reconnect' },
            { id: '2', name: 'Contact B', cStatus: 'Reconnect' },
            { id: '3', name: 'Contact C', cStatus: 'Archive' },
            { id: '4', name: 'Contact D', cStatus: 'Follow-Up' },
            { id: '5', name: 'Contact E', cStatus: 'Engaged' },
          ],
        }),
      } as Response);

      const response = await request(app).get('/api/crm/contacts');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.total).toBe(5);
      expect(response.body.data.stages).toEqual({
        'Reconnect': 2,
        'Archive': 1,
        'Follow-Up': 1,
        'Engaged': 1,
      });
      expect(response.body.data.imminentFollowUps).toBe(0);
    });

    it('handles contacts without cStatus as Unknown', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          total: 2,
          list: [
            { id: '1', name: 'Contact A', cStatus: null },
            { id: '2', name: 'Contact B' },
          ],
        }),
      } as Response);

      const response = await request(app).get('/api/crm/contacts');

      expect(response.body.data.stages).toEqual({ 'Unknown': 2 });
    });

    it('handles empty contact list', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ total: 0, list: [] }),
      } as Response);

      const response = await request(app).get('/api/crm/contacts');

      expect(response.body.data.total).toBe(0);
      expect(response.body.data.stages).toEqual({});
      expect(response.body.data.imminentFollowUps).toBe(0);
    });

    it('counts contacts with overdue cFollowUp as imminent', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          total: 2,
          list: [
            { id: '1', name: 'Overdue', cStatus: 'Follow-Up', cFollowUp: yesterday.toISOString().split('T')[0] },
            { id: '2', name: 'No date', cStatus: 'Follow-Up' },
          ],
        }),
      } as Response);

      const response = await request(app).get('/api/crm/contacts');

      expect(response.body.data.imminentFollowUps).toBe(1);
    });

    it('counts contacts with cFollowUp within 3 days as imminent', async () => {
      const today = new Date();
      const tomorrow = new Date();
      tomorrow.setDate(today.getDate() + 1);
      const inThreeDays = new Date();
      inThreeDays.setDate(today.getDate() + 3);
      const inFiveDays = new Date();
      inFiveDays.setDate(today.getDate() + 5);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          total: 4,
          list: [
            { id: '1', name: 'Today', cStatus: 'Follow-Up', cFollowUp: today.toISOString().split('T')[0] },
            { id: '2', name: 'Tomorrow', cStatus: 'Post-Meeting', cFollowUp: tomorrow.toISOString().split('T')[0] },
            { id: '3', name: 'In 3 days', cStatus: 'Follow-Up', cFollowUp: inThreeDays.toISOString().split('T')[0] },
            { id: '4', name: 'In 5 days', cStatus: 'Follow-Up', cFollowUp: inFiveDays.toISOString().split('T')[0] },
          ],
        }),
      } as Response);

      const response = await request(app).get('/api/crm/contacts');

      expect(response.body.data.imminentFollowUps).toBe(3);
    });

    it('excludes contacts with no cFollowUp from imminent count', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          total: 3,
          list: [
            { id: '1', name: 'No date', cStatus: 'Follow-Up' },
            { id: '2', name: 'Null date', cStatus: 'Follow-Up', cFollowUp: null },
            { id: '3', name: 'Empty date', cStatus: 'Post-Meeting', cFollowUp: '' },
          ],
        }),
      } as Response);

      const response = await request(app).get('/api/crm/contacts');

      expect(response.body.data.imminentFollowUps).toBe(0);
    });

    it('uses correct API endpoint for Contacts', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ total: 0, list: [] }),
      } as Response);

      await request(app).get('/api/crm/contacts');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/Contact',
        expect.objectContaining({
          headers: {
            Authorization: `Basic ${Buffer.from('testuser:testpass').toString('base64')}`,
          },
        })
      );
    });

    it('returns 500 when EspoCRM returns error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      } as Response);

      const response = await request(app).get('/api/crm/contacts');

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/crm/pipeline', () => {
    it('returns pipeline data grouped by stage', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          total: 5,
          list: [
            { id: '1', name: 'Job 1', stage: 'To Apply' },
            { id: '2', name: 'Job 2', stage: 'To Apply' },
            { id: '3', name: 'Job 3', stage: 'Applied' },
            { id: '4', name: 'Job 4', stage: 'Interview' },
            { id: '5', name: 'Job 5', stage: 'To Apply' },
          ],
        }),
      } as Response);

      const response = await request(app).get('/api/crm/pipeline');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.total).toBe(5);
      expect(response.body.data.stages).toEqual({
        'To Apply': 3,
        'Applied': 1,
        'Interview': 1,
      });
    });

    it('handles opportunities with no stage as Unknown', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          total: 2,
          list: [
            { id: '1', name: 'Job 1', stage: 'Applied' },
            { id: '2', name: 'Job 2', stage: '' },
          ],
        }),
      } as Response);

      const response = await request(app).get('/api/crm/pipeline');

      expect(response.status).toBe(200);
      expect(response.body.data.stages).toEqual({
        'Applied': 1,
        'Unknown': 1,
      });
    });

    it('returns empty stages when no opportunities', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          total: 0,
          list: [],
        }),
      } as Response);

      const response = await request(app).get('/api/crm/pipeline');

      expect(response.status).toBe(200);
      expect(response.body.data.total).toBe(0);
      expect(response.body.data.stages).toEqual({});
    });

    it('uses correct auth header for EspoCRM', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ total: 0, list: [] }),
      } as Response);

      await request(app).get('/api/crm/pipeline');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/Opportunity',
        expect.objectContaining({
          headers: {
            Authorization: `Basic ${Buffer.from('testuser:testpass').toString('base64')}`,
          },
        })
      );
    });

    it('returns 500 when EspoCRM returns error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      } as Response);

      const response = await request(app).get('/api/crm/pipeline');

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });

    it('returns 500 when EspoCRM config is missing', async () => {
      delete process.env.ESPO_URL;

      const response = await request(app).get('/api/crm/pipeline');

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
  });
});
