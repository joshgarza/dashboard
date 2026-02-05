import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { errorHandler, notFoundHandler } from '../src/middleware/errorHandler.js';
import { AppError } from '../src/utils/AppError.js';

const createApp = () => {
  const app = express();
  app.use(express.json());

  app.get('/success', (_req, res) => {
    res.json({ success: true, data: 'ok' });
  });

  app.get('/app-error', () => {
    throw new AppError('Resource not found', 404, 'NOT_FOUND');
  });

  app.get('/server-error', () => {
    throw new Error('Internal server error');
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

describe('Error Handler Middleware', () => {
  const app = createApp();

  it('returns 404 for unknown routes', async () => {
    const response = await request(app).get('/unknown-route');

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('returns correct status code for AppError', async () => {
    const response = await request(app).get('/app-error');

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.message).toBe('Resource not found');
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 500 for unhandled errors and logs error', async () => {
    // Mock console.error to suppress expected output and verify it was called
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app).get('/server-error');

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(consoleSpy).toHaveBeenCalledWith('Unhandled error:', expect.any(Error));

    consoleSpy.mockRestore();
  });

  it('follows standard error response format', async () => {
    const response = await request(app).get('/unknown-route');

    expect(response.body).toHaveProperty('success');
    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toHaveProperty('message');
    expect(response.body.error).toHaveProperty('code');
  });
});
