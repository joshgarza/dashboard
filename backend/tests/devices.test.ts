import request from 'supertest';
import express from 'express';
import { devicesRouter, resetRegistry } from '../src/routes/devices.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.use('/api', devicesRouter);
app.use(errorHandler);

describe('Devices API', () => {
  beforeEach(() => {
    resetRegistry();
  });

  describe('POST /api/devices', () => {
    it('registers a new device', async () => {
      const device = {
        name: 'Test Pi',
        host: '192.168.1.100',
        port: 3002,
        type: 'raspberry-pi',
      };

      const response = await request(app)
        .post('/api/devices')
        .send(device);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.name).toBe('Test Pi');
    });

    it('returns 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/devices')
        .send({ name: 'Test' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/devices', () => {
    it('lists all devices', async () => {
      await request(app)
        .post('/api/devices')
        .send({ name: 'Device 1', host: '192.168.1.100', port: 3002, type: 'raspberry-pi' });

      await request(app)
        .post('/api/devices')
        .send({ name: 'Device 2', host: '192.168.1.101', port: 3002, type: 'server' });

      const response = await request(app).get('/api/devices');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
    });

    it('returns empty array when no devices', async () => {
      const response = await request(app).get('/api/devices');

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
    });
  });

  describe('GET /api/devices/:id', () => {
    it('returns a specific device', async () => {
      const createResponse = await request(app)
        .post('/api/devices')
        .send({ name: 'Test Pi', host: '192.168.1.100', port: 3002, type: 'raspberry-pi' });

      const deviceId = createResponse.body.data.id;

      const response = await request(app).get(`/api/devices/${deviceId}`);

      expect(response.status).toBe(200);
      expect(response.body.data.name).toBe('Test Pi');
    });

    it('returns 404 for non-existent device', async () => {
      const response = await request(app).get('/api/devices/non-existent');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe('DELETE /api/devices/:id', () => {
    it('removes a device', async () => {
      const createResponse = await request(app)
        .post('/api/devices')
        .send({ name: 'Test Pi', host: '192.168.1.100', port: 3002, type: 'raspberry-pi' });

      const deviceId = createResponse.body.data.id;

      const deleteResponse = await request(app).delete(`/api/devices/${deviceId}`);

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body.success).toBe(true);

      const getResponse = await request(app).get(`/api/devices/${deviceId}`);
      expect(getResponse.status).toBe(404);
    });

    it('returns 404 for non-existent device', async () => {
      const response = await request(app).delete('/api/devices/non-existent');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });
});
