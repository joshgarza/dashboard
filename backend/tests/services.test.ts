import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';
import Database from 'better-sqlite3';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { backfillServiceWorkHistory, getServiceStatuses } from '../src/services/serviceStatus.js';
import { servicesRouter } from '../src/routes/services.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const app = express();
app.use('/api', servicesRouter);
app.use(errorHandler);

const originalEnv = {
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  LINEAR_API_KEY: process.env.LINEAR_API_KEY,
  HERMES_CONFIG_PATH: process.env.HERMES_CONFIG_PATH,
  HOPPER_DB_PATH: process.env.HOPPER_DB_PATH,
  LOGGER_DB_PATH: process.env.LOGGER_DB_PATH,
  SERVICE_HISTORY_DB_PATH: process.env.SERVICE_HISTORY_DB_PATH,
};

type ManagedEnvName = keyof typeof originalEnv;

function restoreEnv(name: ManagedEnvName): void {
  const value = originalEnv[name];
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function jsonResponse(payload: unknown, status = 200): Response {
  const response = {
    ok: status >= 200 && status < 300,
    status,
    clone: () => response,
    json: () => Promise.resolve(payload),
  } as Response;

  return response;
}

function linearResponse(states: string[]): Response {
  return jsonResponse({
    data: {
      issues: {
        pageInfo: {
          hasNextPage: false,
          endCursor: null,
        },
        nodes: states.map((name) => ({ state: { name } })),
      },
    },
  });
}

function githubPullsResponse(items: unknown[]): Response {
  return jsonResponse(items);
}

function linearBackfillResponse(nodes: unknown[]): Response {
  return jsonResponse({
    data: {
      issues: {
        pageInfo: {
          hasNextPage: false,
          endCursor: null,
        },
        nodes,
      },
    },
  });
}

function projectFromLinearRequest(init: RequestInit | undefined): string | null {
  const body = typeof init?.body === 'string' ? init.body : '{}';
  const parsed = JSON.parse(body) as { variables?: { projectName?: unknown } };
  return typeof parsed.variables?.projectName === 'string' ? parsed.variables.projectName : null;
}

function createSqliteFile(dbPath: string): void {
  const db = new Database(dbPath);
  db.close();
}

describe('Services status', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (Object.keys(originalEnv) as ManagedEnvName[]).forEach(restoreEnv);
  });

  it('checks services from a Hermes config file', async () => {
    process.env.GITHUB_TOKEN = 'test-github-token';
    process.env.LINEAR_API_KEY = 'test-linear-key';

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

    const fetchMock = jest.fn<typeof fetch>((url, init) => {
      const href = String(url);

      if (href.startsWith('https://api.github.com/search/issues')) {
        const query = new URL(href).searchParams.get('q') ?? '';
        return Promise.resolve(jsonResponse({
          total_count: query.includes('joshgarza/hopper') ? 2 : 0,
        }));
      }

      if (href === 'https://api.linear.app/graphql') {
        const project = projectFromLinearRequest(init);
        return Promise.resolve(linearResponse(
          project === 'hopper' ? ['Todo', 'Todo', 'In Progress'] : ['Todo'],
        ));
      }

      return Promise.resolve(jsonResponse({ success: true, data: {} }));
    });
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
      baseUrl: 'http://100.73.184.90:3000',
      status: 'healthy',
      responseTimeMs: expect.any(Number),
    });
    expect(services[1].work?.pullRequests).toEqual({
      repo: 'joshgarza/hopper',
      open: 2,
    });
    expect(services[1].work?.linear).toEqual({
      project: 'hopper',
      total: 3,
      states: [
        { state: 'Todo', count: 2 },
        { state: 'In Progress', count: 1 },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://100.73.184.90:5173/api/health',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://100.73.184.90:3000/api/thoughts?limit=0',
      expect.any(Object),
    );
  });

  it('derives metrics for the Obsidian CouchDB check', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dashboard-services-'));

    globalThis.fetch = ((url: string | URL | Request) => {
      const href = String(url);

      if (href.includes('100.76.162.93:5984')) {
        return Promise.resolve(jsonResponse({
          couchdb: 'Welcome',
          version: '3.3.3',
        }));
      }

      if (href.startsWith('https://api.github.com/search/issues')) {
        return Promise.resolve(jsonResponse({ total_count: 0 }));
      }

      return Promise.resolve(jsonResponse({ success: true, data: {} }));
    }) as typeof fetch;

    const services = await getServiceStatuses({
      configPath: join(dir, 'missing-config.json'),
      hopperDbPath: join(dir, 'missing-hopper.db'),
      loggerDbPath: join(dir, 'missing-logger.db'),
      timeoutMs: 100,
    });

    expect(services.find((service) => service.id === 'crm')).toMatchObject({
      status: 'healthy',
      baseUrl: 'http://100.76.162.93:8080',
    });
    expect(services.find((service) => service.id === 'obsidian')).toMatchObject({
      baseUrl: 'http://100.76.162.93:5984',
    });
    expect(services.find((service) => service.id === 'obsidian')?.metrics).toEqual([
      { label: 'Database', value: 'Welcome' },
      { label: 'Version', value: '3.3.3' },
    ]);
  });

  it('persists service samples and returns recent history', async () => {
    process.env.GITHUB_TOKEN = 'test-github-token';
    process.env.LINEAR_API_KEY = 'test-linear-key';

    const dir = mkdtempSync(join(tmpdir(), 'dashboard-services-'));
    const dbPath = join(dir, 'hopper.db');
    createSqliteFile(dbPath);

    globalThis.fetch = ((url, init) => {
      const href = String(url);

      if (href.startsWith('https://api.github.com/search/issues')) {
        return Promise.resolve(jsonResponse({ total_count: 1 }));
      }

      if (href === 'https://api.linear.app/graphql') {
        const project = projectFromLinearRequest(init);
        return Promise.resolve(linearResponse(project ? ['Todo'] : []));
      }

      if (href === 'http://100.73.184.90:3001/health') {
        return Promise.resolve(jsonResponse({ error: 'atlas down' }, 503));
      }

      if (href === 'http://100.76.162.93:8080/') {
        return Promise.resolve(jsonResponse({
          success: true,
          data: { total: 42, imminentFollowUps: 1 },
        }));
      }

      return Promise.resolve(jsonResponse({ success: true, data: {} }));
    }) as typeof fetch;

    const services = await getServiceStatuses({
      configPath: join(dir, 'missing-config.json'),
      hopperDbPath: dbPath,
      loggerDbPath: join(dir, 'missing-logger.db'),
      timeoutMs: 100,
      historyRange: '24h',
    });

    const crm = services.find((service) => service.id === 'crm');
    const atlas = services.find((service) => service.id === 'atlas');
    const contactsSeries = crm?.history?.metricSeries.find((series) => series.label === 'Contacts');

    expect(crm?.history).toMatchObject({
      range: '24h',
      samples: [expect.objectContaining({ status: 'healthy' })],
    });
    expect(contactsSeries?.points).toEqual([
      expect.objectContaining({ value: 42, numericValue: 42 }),
    ]);
    expect(atlas?.history?.incidents[0]).toMatchObject({
      status: 'unhealthy',
      endedAt: null,
      sampleCount: 1,
      lastError: 'HTTP 503',
    });

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const statusCount = db.prepare(`
        SELECT COUNT(*) AS count
        FROM svc_dashboard_service_status_samples
      `).get() as { count: number };
      const metricCount = db.prepare(`
        SELECT COUNT(*) AS count
        FROM svc_dashboard_service_status_metric_samples
      `).get() as { count: number };

      expect(statusCount.count).toBeGreaterThan(0);
      expect(metricCount.count).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('backfills GitHub PR and Linear work samples without creating uptime samples', async () => {
    process.env.GITHUB_TOKEN = 'test-github-token';
    process.env.LINEAR_API_KEY = 'test-linear-key';

    const dir = mkdtempSync(join(tmpdir(), 'dashboard-services-backfill-'));
    const dbPath = join(dir, 'hopper.db');
    createSqliteFile(dbPath);

    globalThis.fetch = ((url, init) => {
      const href = String(url);

      if (href.startsWith('https://api.github.com/repos/')) {
        return Promise.resolve(githubPullsResponse(
          href.includes('/joshgarza%2Fhopper/') || href.includes('/joshgarza/hopper/')
            ? [
              {
                id: 1,
                number: 10,
                created_at: '2026-04-24T00:00:00.000Z',
                updated_at: '2026-04-24T00:00:00.000Z',
                closed_at: null,
                state: 'open',
              },
              {
                id: 2,
                number: 11,
                created_at: '2026-04-25T12:00:00.000Z',
                updated_at: '2026-04-28T12:00:00.000Z',
                closed_at: '2026-04-28T12:00:00.000Z',
                state: 'closed',
              },
              {
                id: 3,
                number: 12,
                created_at: '2026-04-29T01:00:00.000Z',
                updated_at: '2026-04-29T01:00:00.000Z',
                closed_at: null,
                state: 'open',
              },
            ]
            : [],
        ));
      }

      if (href === 'https://api.linear.app/graphql') {
        const project = projectFromLinearRequest(init);
        return Promise.resolve(linearBackfillResponse(
          project === 'hopper'
            ? [
              {
                id: 'issue-a',
                identifier: 'HOP-1',
                number: 1,
                createdAt: '2026-04-24T08:00:00.000Z',
                completedAt: null,
                canceledAt: null,
                archivedAt: null,
                updatedAt: '2026-04-24T08:00:00.000Z',
                state: { name: 'In Progress', type: 'started' },
              },
              {
                id: 'issue-b',
                identifier: 'HOP-2',
                number: 2,
                createdAt: '2026-04-25T00:00:00.000Z',
                completedAt: '2026-04-27T12:00:00.000Z',
                canceledAt: null,
                archivedAt: null,
                updatedAt: '2026-04-27T12:00:00.000Z',
                state: { name: 'Done', type: 'completed' },
              },
              {
                id: 'issue-c',
                identifier: 'HOP-3',
                number: 3,
                createdAt: '2026-04-28T00:00:00.000Z',
                completedAt: null,
                canceledAt: '2026-04-29T12:00:00.000Z',
                archivedAt: null,
                updatedAt: '2026-04-29T12:00:00.000Z',
                state: { name: 'Canceled', type: 'canceled' },
              },
            ]
            : [],
        ));
      }

      return Promise.resolve(jsonResponse({ success: true, data: {} }));
    }) as typeof fetch;

    const result = await backfillServiceWorkHistory({
      configPath: join(dir, 'missing-config.json'),
      hopperDbPath: dbPath,
      range: '7d',
      now: new Date('2026-04-30T12:00:00.000Z'),
    });

    const hopper = result.services.find((service) => service.serviceId === 'hopper');
    expect(result).toMatchObject({
      range: '7d',
      bucketHours: 24,
    });
    expect(hopper?.github).toMatchObject({
      scope: 'joshgarza/hopper',
      itemCount: 3,
      pointCount: 7,
    });
    expect(hopper?.linear).toMatchObject({
      scope: 'hopper',
      itemCount: 3,
      pointCount: 7,
    });

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const workRows = db.prepare(`
        SELECT sampled_at, open_prs, linear_total
        FROM svc_dashboard_service_work_samples
        WHERE service_id = 'hopper' AND source = 'backfill'
        ORDER BY sampled_at ASC
      `).all() as Array<{ sampled_at: string; open_prs: number | null; linear_total: number | null }>;
      const statusCount = db.prepare(`
        SELECT COUNT(*) AS count
        FROM svc_dashboard_service_status_samples
      `).get() as { count: number };

      expect(workRows).toHaveLength(7);
      expect(workRows[0]).toEqual({
        sampled_at: '2026-04-24T00:00:00.000Z',
        open_prs: 1,
        linear_total: 0,
      });
      expect(workRows.at(-1)).toEqual({
        sampled_at: '2026-04-30T00:00:00.000Z',
        open_prs: 2,
        linear_total: 1,
      });
      expect(statusCount.count).toBe(0);
    } finally {
      db.close();
    }
  });

  it('mounts GET /api/services', async () => {
    process.env.GITHUB_TOKEN = 'test-github-token';
    process.env.LINEAR_API_KEY = 'test-linear-key';
    const dir = mkdtempSync(join(tmpdir(), 'dashboard-services-'));
    const dbPath = join(dir, 'hopper.db');
    createSqliteFile(dbPath);
    process.env.HERMES_CONFIG_PATH = join(dir, 'missing-config.json');
    process.env.HOPPER_DB_PATH = dbPath;
    process.env.SERVICE_HISTORY_DB_PATH = dbPath;
    process.env.LOGGER_DB_PATH = join(dir, 'missing-logger.db');

    globalThis.fetch = ((url, init) => {
      const href = String(url);

      if (href.startsWith('https://api.github.com/search/issues')) {
        return Promise.resolve(jsonResponse({ total_count: 0 }));
      }

      if (href === 'https://api.linear.app/graphql') {
        const project = projectFromLinearRequest(init);
        return Promise.resolve(linearResponse(project ? ['Todo'] : []));
      }

      return Promise.resolve(jsonResponse({ success: true, data: {} }));
    }) as typeof fetch;

    const response = await request(app).get('/api/services?range=7d');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data[0].history.range).toBe('7d');

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const row = db.prepare(`
        SELECT COUNT(*) AS count
        FROM svc_dashboard_service_status_samples
      `).get() as { count: number };
      expect(row.count).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('rejects unsupported service history ranges', async () => {
    const response = await request(app).get('/api/services?range=90d');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, error: 'range must be 24h, 7d, or 30d' });
  });

  it('mounts GET /api/services/history', async () => {
    process.env.GITHUB_TOKEN = 'test-github-token';
    process.env.LINEAR_API_KEY = 'test-linear-key';
    const dir = mkdtempSync(join(tmpdir(), 'dashboard-services-history-'));
    const dbPath = join(dir, 'hopper.db');
    createSqliteFile(dbPath);
    process.env.HERMES_CONFIG_PATH = join(dir, 'missing-config.json');
    process.env.HOPPER_DB_PATH = dbPath;
    process.env.SERVICE_HISTORY_DB_PATH = dbPath;
    process.env.LOGGER_DB_PATH = join(dir, 'missing-logger.db');

    globalThis.fetch = ((url, init) => {
      const href = String(url);

      if (href.startsWith('https://api.github.com/search/issues')) {
        return Promise.resolve(jsonResponse({ total_count: 0 }));
      }

      if (href === 'https://api.linear.app/graphql') {
        const project = projectFromLinearRequest(init);
        return Promise.resolve(linearResponse(project ? ['Todo'] : []));
      }

      return Promise.resolve(jsonResponse({ success: true, data: {} }));
    }) as typeof fetch;

    const response = await request(app).get('/api/services/history?hours=24');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.rangeHours).toBe(24);
    expect(response.body.data.services['dashboard-backend'].samples[0]).toMatchObject({
      status: 'healthy',
      openPrs: expect.any(Number),
      linearTotal: expect.any(Number),
    });
    expect(response.body.data.services['dashboard-backend'].workSamples[0]).toMatchObject({
      openPrs: expect.any(Number),
      linearTotal: expect.any(Number),
    });
  });

  it('mounts POST /api/services/history/backfill', async () => {
    process.env.GITHUB_TOKEN = 'test-github-token';
    process.env.LINEAR_API_KEY = 'test-linear-key';
    const dir = mkdtempSync(join(tmpdir(), 'dashboard-services-route-backfill-'));
    const dbPath = join(dir, 'hopper.db');
    createSqliteFile(dbPath);
    process.env.HERMES_CONFIG_PATH = join(dir, 'missing-config.json');
    process.env.HOPPER_DB_PATH = dbPath;

    globalThis.fetch = ((url, init) => {
      const href = String(url);

      if (href.startsWith('https://api.github.com/repos/')) {
        return Promise.resolve(githubPullsResponse([]));
      }

      if (href === 'https://api.linear.app/graphql') {
        const project = projectFromLinearRequest(init);
        return Promise.resolve(linearBackfillResponse(project ? [] : []));
      }

      return Promise.resolve(jsonResponse({ success: true, data: {} }));
    }) as typeof fetch;

    const response = await request(app).post('/api/services/history/backfill?range=7d');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      range: '7d',
      bucketHours: 24,
    });
    expect(response.body.data.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serviceId: 'hopper',
          github: expect.objectContaining({ scope: 'joshgarza/hopper' }),
          linear: expect.objectContaining({ scope: 'hopper' }),
        }),
      ]),
    );

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const row = db.prepare(`
        SELECT COUNT(*) AS count
        FROM svc_dashboard_service_work_samples
      `).get() as { count: number };
      expect(row.count).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('rejects unsupported service backfill history ranges', async () => {
    const response = await request(app).post('/api/services/history/backfill?range=90d');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, error: 'range must be 24h, 7d, or 30d' });
  });
});
