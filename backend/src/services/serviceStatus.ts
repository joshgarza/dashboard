import fs from 'fs';
import { readFile } from 'fs/promises';
import Database from 'better-sqlite3';

const DEFAULT_HERMES_CONFIG_PATH =
  process.env.HERMES_CONFIG_PATH ?? '/home/josh/coding/claude/hermes-shared/data/hermes.config.json';
const HOPPER_DB_PATH =
  process.env.HOPPER_DB_PATH ?? '/home/josh/coding/claude/hopper-shared/data/hopper.db';
const LOGGER_DB_PATH =
  process.env.LOGGER_DB_PATH ?? '/home/josh/coding/claude/logger-shared/data/logger.db';
const PI_TAILSCALE_HOST = process.env.PI_TAILSCALE_HOST ?? '100.76.162.93';
const CRM_HEALTH_URL =
  process.env.CRM_HEALTH_URL ?? safeOrigin(process.env.ESPO_URL) ?? `http://${PI_TAILSCALE_HOST}:8080`;
const CRM_DISPLAY_URL = process.env.CRM_PUBLIC_URL ?? 'https://crm.joshgarza.dev';
const OBSIDIAN_COUCHDB_URL = process.env.OBSIDIAN_COUCHDB_URL ?? `http://${PI_TAILSCALE_HOST}:5984`;
const DEFAULT_TIMEOUT_MS = 3000;

export type ServiceStatus = 'healthy' | 'unhealthy' | 'timeout' | 'unknown';

export interface ServiceMetric {
  label: string;
  value: number | string;
  tone?: 'default' | 'good' | 'warning' | 'danger';
}

export interface ServiceStatusResult {
  id: string;
  name: string;
  baseUrl: string;
  healthEndpoint: string;
  status: ServiceStatus;
  responseTimeMs: number | null;
  checkedAt: string;
  lastActivityAt?: string | null;
  error?: string;
  metrics: ServiceMetric[];
}

interface ServiceConfig {
  name: string;
  baseUrl: string;
  healthEndpoint: string;
  healthTimeout?: number;
}

interface HermesConfig {
  services?: ServiceConfig[];
}

interface ServiceDefinition extends Required<ServiceConfig> {
  id: string;
  displayUrl?: string;
  useDashboardLoopback?: boolean;
}

function dashboardBaseUrl(): string {
  return `http://localhost:${process.env.PORT ?? '3001'}`;
}

function safeOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;

  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

const BASELINE_SERVICE_DEFINITIONS: ServiceDefinition[] = [
  {
    id: 'hopper',
    name: 'hopper',
    baseUrl: 'http://localhost:3000',
    healthEndpoint: '/api/thoughts?limit=0',
    healthTimeout: DEFAULT_TIMEOUT_MS,
  },
  {
    id: 'atlas',
    name: 'atlas',
    baseUrl: 'http://localhost:3001',
    healthEndpoint: '/health',
    healthTimeout: DEFAULT_TIMEOUT_MS,
  },
  {
    id: 'logger',
    name: 'logger',
    baseUrl: 'http://localhost:3002',
    healthEndpoint: '/health',
    healthTimeout: DEFAULT_TIMEOUT_MS,
  },
  {
    id: 'crm',
    name: 'crm',
    baseUrl: CRM_HEALTH_URL,
    displayUrl: CRM_DISPLAY_URL,
    healthEndpoint: '/',
    healthTimeout: DEFAULT_TIMEOUT_MS,
  },
  {
    id: 'obsidian',
    name: 'obsidian-db',
    baseUrl: OBSIDIAN_COUCHDB_URL,
    displayUrl: 'Obsidian CouchDB',
    healthEndpoint: '/',
    healthTimeout: DEFAULT_TIMEOUT_MS,
  },
];

export interface ServiceStatusOptions {
  configPath?: string;
  hopperDbPath?: string;
  loggerDbPath?: string;
  timeoutMs?: number;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeConfigService(value: unknown): ServiceDefinition | null {
  if (!isRecord(value)) return null;
  const { name, baseUrl, healthEndpoint, healthTimeout } = value;
  if (typeof name !== 'string' || typeof baseUrl !== 'string' || typeof healthEndpoint !== 'string') {
    return null;
  }

  return {
    id: slugify(name),
    name,
    baseUrl,
    healthEndpoint,
    healthTimeout: typeof healthTimeout === 'number' ? healthTimeout : DEFAULT_TIMEOUT_MS,
  };
}

function appendUniqueService(definitions: ServiceDefinition[], service: ServiceDefinition): void {
  if (!definitions.some((item) => item.id === service.id)) {
    definitions.push(service);
  }
}

async function loadServiceDefinitions(configPath: string): Promise<ServiceDefinition[]> {
  const definitions: ServiceDefinition[] = [
    {
      id: 'dashboard-backend',
      name: 'dashboard-backend',
      baseUrl: `http://localhost:${process.env.PORT ?? '3001'}`,
      healthEndpoint: '/api/health',
      healthTimeout: DEFAULT_TIMEOUT_MS,
    },
  ];

  if (fs.existsSync(configPath)) {
    const raw = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as HermesConfig;
    const services = Array.isArray(parsed.services) ? parsed.services : [];

    for (const service of services) {
      const normalized = normalizeConfigService(service);
      if (normalized) {
        appendUniqueService(definitions, normalized);
      }
    }
  }

  for (const service of BASELINE_SERVICE_DEFINITIONS) {
    appendUniqueService(definitions, service);
  }

    return definitions;
}

function resolveProbeUrl(service: ServiceDefinition): string {
  const url = new URL(service.healthEndpoint, service.baseUrl);

  if (
    fs.existsSync('/.dockerenv') &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
    service.id !== 'dashboard-backend' &&
    !service.useDashboardLoopback
  ) {
    url.hostname = process.env.SERVICE_STATUS_LOCALHOST_HOST ?? 'host.docker.internal';
  }

  return url.toString();
}

async function tryReadJson(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function deriveProbeMetrics(serviceId: string, payload: unknown): ServiceMetric[] {
  if (serviceId === 'obsidian' && isRecord(payload)) {
    const version = typeof payload.version === 'string' ? payload.version : null;
    const couchdb = typeof payload.couchdb === 'string' ? payload.couchdb : null;

    return [
      ...(couchdb === null ? [] : [{ label: 'Database', value: couchdb }]),
      ...(version === null ? [] : [{ label: 'Version', value: version }]),
    ];
  }

  if (!isRecord(payload) || !isRecord(payload.data)) {
    return [];
  }

  if (serviceId === 'crm') {
    const total = getNumber(payload.data.total);
    const imminentFollowUps = getNumber(payload.data.imminentFollowUps);

    return [
      ...(total === null ? [] : [{ label: 'Contacts', value: total }]),
      ...(imminentFollowUps === null
        ? []
        : [{ label: 'Follow-ups', value: imminentFollowUps, tone: imminentFollowUps > 0 ? 'warning' as const : 'default' as const }]),
    ];
  }

  return [];
}

async function checkServiceHealth(service: ServiceDefinition): Promise<ServiceStatusResult> {
  const checkedAt = new Date().toISOString();
  const probeUrl = resolveProbeUrl(service);
  const start = performance.now();

  try {
    const response = await fetch(probeUrl, {
      signal: AbortSignal.timeout(service.healthTimeout),
    });
    const responseTimeMs = Math.round(performance.now() - start);
    const payload = response.ok ? await tryReadJson(response) : null;

    return {
      id: service.id,
      name: service.name,
      baseUrl: service.displayUrl ?? service.baseUrl,
      healthEndpoint: service.healthEndpoint,
      status: response.ok ? 'healthy' : 'unhealthy',
      responseTimeMs,
      checkedAt,
      error: response.ok ? undefined : `HTTP ${response.status}`,
      metrics: deriveProbeMetrics(service.id, payload),
    };
  } catch (error) {
    const responseTimeMs = Math.round(performance.now() - start);
    const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';

    return {
      id: service.id,
      name: service.name,
      baseUrl: service.displayUrl ?? service.baseUrl,
      healthEndpoint: service.healthEndpoint,
      status: isTimeout ? 'timeout' : 'unhealthy',
      responseTimeMs,
      checkedAt,
      error: error instanceof Error ? error.message : String(error),
      metrics: [],
    };
  }
}

function readSqliteMetrics<T>(dbPath: string, reader: (db: Database.Database) => T): T | null {
  if (!fs.existsSync(dbPath)) {
    return null;
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return reader(db);
  } finally {
    db.close();
  }
}

function count(db: Database.Database, sql: string): number {
  const row = db.prepare(sql).get() as { count: number };
  return row.count;
}

function readHopperMetrics(dbPath: string): Pick<ServiceStatusResult, 'metrics' | 'lastActivityAt'> | null {
  return readSqliteMetrics(dbPath, (db) => {
    const latestRow = db.prepare(`
      SELECT MAX(COALESCE(processed_at, created_at)) AS latest
      FROM thoughts
    `).get() as { latest: string | null };

    return {
      lastActivityAt: latestRow.latest,
      metrics: [
        { label: 'Thoughts', value: count(db, 'SELECT COUNT(*) AS count FROM thoughts') },
        {
          label: 'Review',
          value: count(db, "SELECT COUNT(*) AS count FROM thoughts WHERE status = 'needs-review'"),
          tone: 'warning' as const,
        },
        {
          label: 'Research failed',
          value: count(db, "SELECT COUNT(*) AS count FROM svc_research_queue_items WHERE status = 'failed'"),
          tone: 'danger' as const,
        },
        {
          label: 'Weekly open',
          value: count(db, 'SELECT COUNT(*) AS count FROM svc_weekly_review_tasks WHERE completed = 0'),
          tone: 'warning' as const,
        },
      ],
    };
  });
}

function readLoggerMetrics(dbPath: string): Pick<ServiceStatusResult, 'metrics' | 'lastActivityAt'> | null {
  return readSqliteMetrics(dbPath, (db) => {
    const latestRow = db.prepare(`
      SELECT MAX(timestamp) AS latest
      FROM log_entries
    `).get() as { latest: string | null };

    return {
      lastActivityAt: latestRow.latest,
      metrics: [
        { label: 'Logs', value: count(db, 'SELECT COUNT(*) AS count FROM log_entries') },
        { label: 'Metrics', value: count(db, 'SELECT COUNT(*) AS count FROM metrics') },
      ],
    };
  });
}

function attachLocalMetrics(
  result: ServiceStatusResult,
  options: Required<Pick<ServiceStatusOptions, 'hopperDbPath' | 'loggerDbPath'>>,
): ServiceStatusResult {
  if (result.id === 'hopper') {
    const hopperMetrics = readHopperMetrics(options.hopperDbPath);
    return hopperMetrics ? { ...result, ...hopperMetrics } : result;
  }

  if (result.id === 'logger') {
    const loggerMetrics = readLoggerMetrics(options.loggerDbPath);
    return loggerMetrics ? { ...result, ...loggerMetrics } : result;
  }

  return result;
}

export async function getServiceStatuses(options: ServiceStatusOptions = {}): Promise<ServiceStatusResult[]> {
  const configPath = options.configPath ?? DEFAULT_HERMES_CONFIG_PATH;
  const hopperDbPath = options.hopperDbPath ?? HOPPER_DB_PATH;
  const loggerDbPath = options.loggerDbPath ?? LOGGER_DB_PATH;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const definitions = await loadServiceDefinitions(configPath);

  const results = await Promise.all(
    definitions.map(async (definition) => {
      const base = await checkServiceHealth({ ...definition, healthTimeout: definition.healthTimeout || timeoutMs });
      return attachLocalMetrics(base, { hopperDbPath, loggerDbPath });
    }),
  );

  return results;
}
