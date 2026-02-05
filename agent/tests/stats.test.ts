import request from 'supertest';
import express from 'express';
import statsRouter from '../src/routes/stats.js';

const app = express();
app.use('/api', statsRouter);

describe('Stats API', () => {
  describe('GET /api/stats', () => {
    it('returns 200 status code', async () => {
      const response = await request(app).get('/api/stats');
      expect(response.status).toBe(200);
    });

    it('returns cpu percentage', async () => {
      const response = await request(app).get('/api/stats');
      expect(response.body).toHaveProperty('cpu');
      expect(typeof response.body.cpu).toBe('number');
      expect(response.body.cpu).toBeGreaterThanOrEqual(0);
      expect(response.body.cpu).toBeLessThanOrEqual(100);
    });

    it('returns memory stats with used and total', async () => {
      const response = await request(app).get('/api/stats');
      expect(response.body).toHaveProperty('memory');
      expect(response.body.memory).toHaveProperty('used');
      expect(response.body.memory).toHaveProperty('total');
      expect(typeof response.body.memory.used).toBe('number');
      expect(typeof response.body.memory.total).toBe('number');
      expect(response.body.memory.used).toBeLessThanOrEqual(response.body.memory.total);
    });

    it('returns disk stats with used and total', async () => {
      const response = await request(app).get('/api/stats');
      expect(response.body).toHaveProperty('disk');
      expect(response.body.disk).toHaveProperty('used');
      expect(response.body.disk).toHaveProperty('total');
      expect(typeof response.body.disk.used).toBe('number');
      expect(typeof response.body.disk.total).toBe('number');
    });

    it('returns uptime in seconds', async () => {
      const response = await request(app).get('/api/stats');
      expect(response.body).toHaveProperty('uptime');
      expect(typeof response.body.uptime).toBe('number');
      expect(response.body.uptime).toBeGreaterThan(0);
    });

    it('returns hostname', async () => {
      const response = await request(app).get('/api/stats');
      expect(response.body).toHaveProperty('hostname');
      expect(typeof response.body.hostname).toBe('string');
    });
  });

  describe('GET /api/health', () => {
    it('returns 200 status code', async () => {
      const response = await request(app).get('/api/health');
      expect(response.status).toBe(200);
    });

    it('returns ok status', async () => {
      const response = await request(app).get('/api/health');
      expect(response.body).toEqual({ status: 'ok' });
    });
  });
});
