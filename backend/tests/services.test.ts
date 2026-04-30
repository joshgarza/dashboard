import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getServiceStatuses } from '../src/services/serviceStatus.js';
import { servicesRouter } from '../src/routes/services.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const app = express();
app.use('/api', servicesRouter);
app.use(errorHandler);

describe('Services status', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('checks services from a Hermes config file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dashboard-services-'));
    const configPath = join(dir, 'hermes.config.json');
    writeFileSync(configPath, JSON.stringify({
      services: [
        {
          name: 'hopper',
          baseUrl: 'http://localhost:3000',
          healthEndpoint: '/api/thoughts?limit=0',
        },
      ],
    }));

    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);
    globalThis.fetch = fetchMock;

    const services = await getServiceStatuses({
      configPath,
      hopperDbPath: join(dir, 'missing-hopper.db'),
      loggerDbPath: join(dir, 'missing-logger.db'),
      timeoutMs: 100,
    });

    expect(services.map((service) => service.id)).toEqual(
      expect.arrayContaining(['dashboard-backend', 'hopper', 'atlas', 'logger', 'crm', 'obsidian']),
    );
    expect(services[1]).toMatchObject({
      id: 'hopper',
      status: 'healthy',
      responseTimeMs: expect.any(Number),
    });
  });

  it('derives metrics for the Obsidian CouchDB check', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dashboard-services-'));

    globalThis.fetch = ((url: string | URL | Request) => {
      const href = String(url);

      if (href.includes('100.76.162.93:5984')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          clone() {
            return this;
          },
          json: () => Promise.resolve({
            couchdb: 'Welcome',
            version: '3.3.3',
          }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        clone() {
          return this;
        },
        json: () => Promise.resolve({ success: true, data: {} }),
      } as Response);
    }) as typeof fetch;

    const services = await getServiceStatuses({
      configPath: join(dir, 'missing-config.json'),
      hopperDbPath: join(dir, 'missing-hopper.db'),
      loggerDbPath: join(dir, 'missing-logger.db'),
      timeoutMs: 100,
    });

    expect(services.find((service) => service.id === 'crm')).toMatchObject({
      status: 'healthy',
      baseUrl: 'https://crm.joshgarza.dev',
    });
    expect(services.find((service) => service.id === 'obsidian')?.metrics).toEqual([
      { label: 'Database', value: 'Welcome' },
      { label: 'Version', value: '3.3.3' },
    ]);
  });

  it('mounts GET /api/services', async () => {
    const response = await request(app).get('/api/services');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
  });
});
