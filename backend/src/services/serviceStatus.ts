import fs from 'fs';
import { readFile } from 'fs/promises';
import Database from 'better-sqlite3';

const DEFAULT_HERMES_CONFIG_PATH = '/home/josh/coding/claude/hermes-shared/data/hermes.config.json';
const DEFAULT_HOPPER_DB_PATH = '/home/josh/coding/claude/hopper-shared/data/hopper.db';
const DEFAULT_LOGGER_DB_PATH = '/home/josh/coding/claude/logger-shared/data/logger.db';
const DASHBOARD_TAILSCALE_HOST = process.env.DASHBOARD_TAILSCALE_HOST ?? '100.73.184.90';
const PI_TAILSCALE_HOST = process.env.PI_TAILSCALE_HOST ?? '100.76.162.93';
const DASHBOARD_PUBLIC_URL =
  process.env.DASHBOARD_PUBLIC_URL ?? `http://${DASHBOARD_TAILSCALE_HOST}:5173`;
const CRM_HEALTH_URL =
  process.env.CRM_HEALTH_URL ?? safeOrigin(process.env.ESPO_URL) ?? `http://${PI_TAILSCALE_HOST}:8080`;
const CRM_DISPLAY_URL = process.env.CRM_DISPLAY_URL ?? CRM_HEALTH_URL;
const OBSIDIAN_COUCHDB_URL = process.env.OBSIDIAN_COUCHDB_URL ?? `http://${PI_TAILSCALE_HOST}:5984`;
const OBSIDIAN_COUCHDB_DISPLAY_URL = process.env.OBSIDIAN_COUCHDB_DISPLAY_URL ?? OBSIDIAN_COUCHDB_URL;
const DEFAULT_TIMEOUT_MS = 3000;
const SERVICE_WORK_TIMEOUT_MS = parsePositiveInteger(process.env.SERVICE_WORK_TIMEOUT_MS, 4000);
const SERVICE_WORK_CACHE_MS = parsePositiveInteger(process.env.SERVICE_WORK_CACHE_MS, 5 * 60 * 1000);
const LINEAR_ISSUE_PAGE_LIMIT = 100;
const LINEAR_ISSUE_MAX_PAGES = 10;
const GITHUB_BACKFILL_PAGE_LIMIT = 100;
const GITHUB_BACKFILL_MAX_PAGES = parsePositiveInteger(process.env.GITHUB_BACKFILL_MAX_PAGES, 10);
const SERVICE_HISTORY_DEFAULT_RANGE: ServiceHistoryRange = '24h';
const SERVICE_HISTORY_RANGE_MS: Record<ServiceHistoryRange, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};
const SERVICE_HISTORY_RETENTION_MS = 31 * 24 * 60 * 60 * 1000;
const SERVICE_HISTORY_SAMPLE_LIMIT = 240;
const SERVICE_HISTORY_RAW_ROW_LIMIT = 12_000;
const SERVICE_HISTORY_INCIDENT_LIMIT = 20;

const LINEAR_ISSUE_STATE_QUERY = `
  query ProjectIssueStates($projectName: String!, $first: Int!, $after: String) {
    issues(
      first: $first
      after: $after
      filter: { project: { name: { eq: $projectName } } }
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        state {
          name
          type
        }
      }
    }
  }
`;

const LINEAR_ISSUE_BACKFILL_QUERY = `
  query ProjectIssuesForBackfill($projectName: String!, $first: Int!, $after: String) {
    issues(
      first: $first
      after: $after
      includeArchived: true
      filter: { project: { name: { eq: $projectName } } }
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        identifier
        number
        createdAt
        completedAt
        canceledAt
        archivedAt
        updatedAt
        state {
          name
          type
        }
      }
    }
  }
`;

const LINEAR_ISSUE_BACKFILL_FALLBACK_QUERY = `
  query ProjectIssuesForBackfill($projectName: String!, $first: Int!, $after: String) {
    issues(
      first: $first
      after: $after
      filter: { project: { name: { eq: $projectName } } }
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        identifier
        number
        createdAt
        completedAt
        canceledAt
        archivedAt
        updatedAt
        state {
          name
          type
        }
      }
    }
  }
`;

export type ServiceStatus = 'healthy' | 'unhealthy' | 'timeout' | 'unknown';
export type ServiceHistoryRange = '24h' | '7d' | '30d';

export interface ServiceMetric {
  label: string;
  value: number | string;
  tone?: 'default' | 'good' | 'warning' | 'danger';
}

export interface ServicePullRequestSummary {
  repo: string;
  open: number | null;
  error?: string;
}

export interface ServiceLinearStateCount {
  state: string;
  count: number;
}

export interface ServiceLinearSummary {
  project: string;
  states: ServiceLinearStateCount[];
  total: number | null;
  error?: string;
}

export interface ServiceWorkSummary {
  pullRequests?: ServicePullRequestSummary;
  linear?: ServiceLinearSummary;
}

export interface ServiceHistorySample {
  checkedAt: string;
  status: ServiceStatus;
  responseTimeMs: number | null;
  openPrs: number | null;
  linearTotal: number | null;
  error?: string;
}

export interface ServiceWorkHistorySample {
  checkedAt: string;
  openPrs: number | null;
  linearTotal: number | null;
}

export interface ServiceMetricPoint {
  checkedAt: string;
  value: number | string;
  numericValue?: number;
}

export interface ServiceMetricSeries {
  label: string;
  tone?: ServiceMetric['tone'];
  points: ServiceMetricPoint[];
}

export interface ServiceIncident {
  startedAt: string;
  endedAt: string | null;
  status: Exclude<ServiceStatus, 'healthy'>;
  sampleCount: number;
  lastError?: string;
}

export interface ServiceStatusHistory {
  range: ServiceHistoryRange;
  from: string;
  to: string;
  samples: ServiceHistorySample[];
  workSamples: ServiceWorkHistorySample[];
  metricSeries: ServiceMetricSeries[];
  incidents: ServiceIncident[];
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
  work?: ServiceWorkSummary;
  history?: ServiceStatusHistory;
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
  githubRepo?: string;
  linearProject?: string;
}

interface CacheEntry<T> {
  expiresAt: number;
  promise: Promise<T>;
}

interface LinearIssueStateItem {
  name: string;
  type: string | null;
}

interface LinearIssuePage {
  states: LinearIssueStateItem[];
  hasNextPage: boolean;
  endCursor: string | null;
}

interface LinearBackfillIssueFact {
  id: string;
  identifier: string | null;
  number: number | null;
  openedAt: string;
  completedAt: string | null;
  canceledAt: string | null;
  archivedAt: string | null;
  updatedAt: string | null;
  currentStateName: string | null;
  stateType: string | null;
}

interface LinearBackfillIssuePage {
  facts: LinearBackfillIssueFact[];
  hasNextPage: boolean;
  endCursor: string | null;
}

interface GithubPullRequestFact {
  id: string;
  number: number | null;
  openedAt: string;
  updatedAt: string | null;
  closedAt: string | null;
  state: string | null;
}

interface ServiceHistoryStatusRow {
  checked_at: string;
  status: ServiceStatus;
  response_time_ms: number | null;
  open_prs: number | null;
  linear_total: number | null;
  error: string | null;
}

interface ServiceHistoryMetricRow {
  label: string;
  value_json: string;
  numeric_value: number | null;
  tone: ServiceMetric['tone'] | null;
  sampled_at: string;
}

interface ServiceHistoryWorkRow {
  sampled_at: string;
  open_prs: number | null;
  linear_total: number | null;
}

interface ServiceWorkSampleInsert {
  serviceId: string;
  serviceName: string;
  openPrs: number | null;
  linearTotal: number | null;
  sampledAt: string;
  source: 'live' | 'backfill';
}

const githubPullRequestCache = new Map<string, CacheEntry<ServicePullRequestSummary>>();
const linearSummaryCache = new Map<string, CacheEntry<ServiceLinearSummary>>();

function safeOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;

  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function tailnetBaseUrl(port: number): string {
  return `http://${DASHBOARD_TAILSCALE_HOST}:${port}`;
}

function rewriteLocalhostToTailnet(value: string): string {
  try {
    const url = new URL(value);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      url.hostname = DASHBOARD_TAILSCALE_HOST;
    }

    return url.toString().replace(/\/$/, '');
  } catch {
    return value;
  }
}

const BASELINE_SERVICE_DEFINITIONS: ServiceDefinition[] = [
  {
    id: 'hopper',
    name: 'hopper',
    baseUrl: tailnetBaseUrl(3000),
    healthEndpoint: '/api/thoughts?limit=0',
    healthTimeout: DEFAULT_TIMEOUT_MS,
    githubRepo: 'joshgarza/hopper',
    linearProject: 'hopper',
  },
  {
    id: 'atlas',
    name: 'atlas',
    baseUrl: tailnetBaseUrl(3001),
    healthEndpoint: '/health',
    healthTimeout: DEFAULT_TIMEOUT_MS,
    githubRepo: 'joshgarza/atlas',
    linearProject: 'atlas',
  },
  {
    id: 'logger',
    name: 'logger',
    baseUrl: tailnetBaseUrl(3002),
    healthEndpoint: '/health',
    healthTimeout: DEFAULT_TIMEOUT_MS,
    githubRepo: 'joshgarza/logger',
    linearProject: 'logger',
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
    displayUrl: OBSIDIAN_COUCHDB_DISPLAY_URL,
    healthEndpoint: '/',
    healthTimeout: DEFAULT_TIMEOUT_MS,
  },
];

export interface ServiceStatusOptions {
  configPath?: string;
  hopperDbPath?: string;
  loggerDbPath?: string;
  timeoutMs?: number;
  historyRange?: ServiceHistoryRange;
}

export interface ServiceWorkHistoryBackfillOptions {
  configPath?: string;
  hopperDbPath?: string;
  range?: ServiceHistoryRange;
  now?: Date;
}

export interface ServiceWorkHistoryBackfillProviderResult {
  scope: string;
  itemCount: number;
  pointCount: number;
  error?: string;
}

export interface ServiceWorkHistoryBackfillServiceResult {
  serviceId: string;
  serviceName: string;
  github?: ServiceWorkHistoryBackfillProviderResult;
  linear?: ServiceWorkHistoryBackfillProviderResult;
}

export interface ServiceWorkHistoryBackfillResult {
  range: ServiceHistoryRange;
  from: string;
  to: string;
  bucketHours: number;
  generatedAt: string;
  services: ServiceWorkHistoryBackfillServiceResult[];
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
    baseUrl: rewriteLocalhostToTailnet(baseUrl),
    healthEndpoint,
    healthTimeout: typeof healthTimeout === 'number' ? healthTimeout : DEFAULT_TIMEOUT_MS,
  };
}

function appendUniqueService(definitions: ServiceDefinition[], service: ServiceDefinition): void {
  const existing = definitions.find((item) => item.id === service.id);

  if (existing) {
    existing.displayUrl ??= service.displayUrl;
    existing.githubRepo ??= service.githubRepo;
    existing.linearProject ??= service.linearProject;
    existing.useDashboardLoopback ??= service.useDashboardLoopback;
    return;
  }

  definitions.push(service);
}

async function loadServiceDefinitions(configPath: string): Promise<ServiceDefinition[]> {
  const definitions: ServiceDefinition[] = [
    {
      id: 'dashboard-backend',
      name: 'dashboard-backend',
      baseUrl: DASHBOARD_PUBLIC_URL,
      healthEndpoint: '/api/health',
      healthTimeout: DEFAULT_TIMEOUT_MS,
      githubRepo: 'joshgarza/dashboard',
      linearProject: 'dashboard',
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

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function getApiErrorMessage(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const message = getString(payload.message);
  if (message) return message;

  if (Array.isArray(payload.errors)) {
    const first = payload.errors.find(isRecord);
    if (first) return getString(first.message);
  }

  return null;
}

function isClosedLinearStateType(type: string | null): boolean {
  return type === 'completed' || type === 'canceled';
}

function formatExternalError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return 'Request timed out';
  }

  return error instanceof Error ? error.message : String(error);
}

function getCached<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const cached = cache.get(key);

  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = load();
  cache.set(key, { expiresAt: now + SERVICE_WORK_CACHE_MS, promise });
  return promise;
}

async function fetchGithubPullRequestSummary(repo: string): Promise<ServicePullRequestSummary> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const cacheKey = `${repo}:${token ? 'auth' : 'anon'}`;

  return getCached(githubPullRequestCache, cacheKey, async () => {
    try {
      const url = new URL('https://api.github.com/search/issues');
      url.searchParams.set('q', `repo:${repo} is:pr is:open`);

      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'dashboard-service-status',
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(url.toString(), {
        headers,
        signal: AbortSignal.timeout(SERVICE_WORK_TIMEOUT_MS),
      });
      const payload = await tryReadJson(response);

      if (!response.ok) {
        return { repo, open: null, error: getApiErrorMessage(payload) ?? `HTTP ${response.status}` };
      }

      if (isRecord(payload) && typeof payload.total_count === 'number') {
        return { repo, open: payload.total_count };
      }

      return { repo, open: null, error: 'Unexpected GitHub response' };
    } catch (error) {
      return { repo, open: null, error: formatExternalError(error) };
    }
  });
}

function parseLinearIssuePage(payload: unknown): LinearIssuePage | null {
  if (!isRecord(payload) || !isRecord(payload.data) || !isRecord(payload.data.issues)) {
    return null;
  }

  const { pageInfo, nodes } = payload.data.issues;
  if (!isRecord(pageInfo) || !Array.isArray(nodes)) {
    return null;
  }

  return {
    states: nodes.flatMap((node) => {
      if (!isRecord(node) || !isRecord(node.state)) return [];
      const state = getString(node.state.name);
      return state ? [{ name: state, type: getString(node.state.type) }] : [];
    }),
    hasNextPage: pageInfo.hasNextPage === true,
    endCursor: getString(pageInfo.endCursor),
  };
}

function sortLinearStateCounts(counts: Map<string, number>): ServiceLinearStateCount[] {
  const preferredOrder = ['Triage', 'Backlog', 'Todo', 'In Progress', 'In Review', 'Review', 'Done', 'Canceled'];

  return Array.from(counts.entries())
    .map(([state, count]) => ({ state, count }))
    .sort((a, b) => {
      const aIndex = preferredOrder.indexOf(a.state);
      const bIndex = preferredOrder.indexOf(b.state);

      if (aIndex !== -1 || bIndex !== -1) {
        return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) -
          (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
      }

      return a.state.localeCompare(b.state);
    });
}

async function fetchLinearSummary(project: string): Promise<ServiceLinearSummary> {
  const token = process.env.LINEAR_API_KEY;
  if (!token) {
    return {
      project,
      states: [],
      total: null,
      error: 'LINEAR_API_KEY not configured',
    };
  }

  return getCached(linearSummaryCache, `${project}:configured`, async () => {
    const counts = new Map<string, number>();
    let after: string | null = null;

    try {
      for (let page = 0; page < LINEAR_ISSUE_MAX_PAGES; page += 1) {
        const response = await fetch('https://api.linear.app/graphql', {
          method: 'POST',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: LINEAR_ISSUE_STATE_QUERY,
            variables: { projectName: project, first: LINEAR_ISSUE_PAGE_LIMIT, after },
          }),
          signal: AbortSignal.timeout(SERVICE_WORK_TIMEOUT_MS),
        });
        const payload = await tryReadJson(response);

        if (!response.ok) {
          return {
            project,
            states: [],
            total: null,
            error: getApiErrorMessage(payload) ?? `HTTP ${response.status}`,
          };
        }

        const apiError = getApiErrorMessage(payload);
        if (apiError) {
          return { project, states: [], total: null, error: apiError };
        }

        const issuePage = parseLinearIssuePage(payload);
        if (!issuePage) {
          return { project, states: [], total: null, error: 'Unexpected Linear response' };
        }

        for (const state of issuePage.states) {
          if (isClosedLinearStateType(state.type)) continue;
          counts.set(state.name, (counts.get(state.name) ?? 0) + 1);
        }

        if (!issuePage.hasNextPage) break;
        after = issuePage.endCursor;

        if (!after) {
          return { project, states: [], total: null, error: 'Linear pagination cursor missing' };
        }
      }

      const states = sortLinearStateCounts(counts);
      return {
        project,
        states,
        total: states.reduce((sum, item) => sum + item.count, 0),
      };
    } catch (error) {
      return { project, states: [], total: null, error: formatExternalError(error) };
    }
  });
}

async function fetchServiceWorkSummary(service: ServiceDefinition): Promise<ServiceWorkSummary | undefined> {
  if (!service.githubRepo && !service.linearProject) {
    return undefined;
  }

  const [pullRequests, linear] = await Promise.all([
    service.githubRepo ? fetchGithubPullRequestSummary(service.githubRepo) : Promise.resolve(undefined),
    service.linearProject ? fetchLinearSummary(service.linearProject) : Promise.resolve(undefined),
  ]);

  return {
    ...(pullRequests ? { pullRequests } : {}),
    ...(linear ? { linear } : {}),
  };
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
  } catch {
    return null;
  } finally {
    db.close();
  }
}

function count(db: Database.Database, sql: string): number {
  const row = db.prepare(sql).get() as { count: number };
  return row.count;
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db.prepare(`
    SELECT 1 AS exists_flag
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(tableName) as { exists_flag: number } | undefined;

  return row !== undefined;
}

function readHopperMetrics(dbPath: string): Pick<ServiceStatusResult, 'metrics' | 'lastActivityAt'> | null {
  return readSqliteMetrics(dbPath, (db) => {
    if (!tableExists(db, 'thoughts')) {
      return null;
    }

    const latestRow = db.prepare(`
      SELECT MAX(COALESCE(processed_at, created_at)) AS latest
      FROM thoughts
    `).get() as { latest: string | null };

    const metrics: ServiceMetric[] = [
      { label: 'Thoughts', value: count(db, 'SELECT COUNT(*) AS count FROM thoughts') },
      {
        label: 'Review',
        value: count(db, "SELECT COUNT(*) AS count FROM thoughts WHERE status = 'needs-review'"),
        tone: 'warning' as const,
      },
    ];

    if (tableExists(db, 'svc_research_queue_items')) {
      metrics.push({
        label: 'Research failed',
        value: count(db, "SELECT COUNT(*) AS count FROM svc_research_queue_items WHERE status = 'failed'"),
        tone: 'danger' as const,
      });
    }

    if (tableExists(db, 'svc_weekly_review_tasks')) {
      metrics.push({
        label: 'Weekly open',
        value: count(db, 'SELECT COUNT(*) AS count FROM svc_weekly_review_tasks WHERE completed = 0'),
        tone: 'warning' as const,
      });
    }

    return {
      lastActivityAt: latestRow.latest,
      metrics,
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

export function parseServiceHistoryRange(value: unknown): ServiceHistoryRange | null {
  const raw = Array.isArray(value) ? value[0] : value;

  if (raw === undefined) {
    return SERVICE_HISTORY_DEFAULT_RANGE;
  }

  return raw === '24h' || raw === '7d' || raw === '30d' ? raw : null;
}

function getHistoryWindow(range: ServiceHistoryRange, now = new Date()): Pick<ServiceStatusHistory, 'range' | 'from' | 'to'> {
  const to = now.toISOString();
  const from = new Date(now.getTime() - SERVICE_HISTORY_RANGE_MS[range]).toISOString();

  return { range, from, to };
}

function emptyServiceHistory(range: ServiceHistoryRange, from: string, to: string): ServiceStatusHistory {
  return {
    range,
    from,
    to,
    samples: [],
    workSamples: [],
    metricSeries: [],
    incidents: [],
  };
}

function withServiceHistoryDb<T>(
  dbPath: string,
  fallback: T,
  action: (db: Database.Database) => T,
): T {
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    ensureServiceHistorySchema(db);
    return action(db);
  } catch {
    return fallback;
  } finally {
    db?.close();
  }
}

function ensureServiceHistorySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS svc_dashboard_service_status_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id TEXT NOT NULL,
      service_name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      health_endpoint TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('healthy', 'unhealthy', 'timeout', 'unknown')),
      response_time_ms INTEGER,
      open_prs INTEGER,
      linear_total INTEGER,
      error TEXT,
      checked_at TEXT NOT NULL,
      sampled_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS svc_dashboard_service_status_metric_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status_sample_id INTEGER NOT NULL
        REFERENCES svc_dashboard_service_status_samples(id) ON DELETE CASCADE,
      service_id TEXT NOT NULL,
      label TEXT NOT NULL,
      value_json TEXT NOT NULL,
      numeric_value REAL,
      tone TEXT CHECK (tone IS NULL OR tone IN ('default', 'good', 'warning', 'danger')),
      sampled_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS svc_dashboard_service_work_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id TEXT NOT NULL,
      service_name TEXT NOT NULL,
      open_prs INTEGER,
      linear_total INTEGER,
      source TEXT NOT NULL DEFAULT 'live' CHECK (source IN ('live', 'backfill')),
      sampled_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(service_id, sampled_at, source)
    );

    CREATE INDEX IF NOT EXISTS idx_svc_dashboard_sss_service_sampled
      ON svc_dashboard_service_status_samples(service_id, sampled_at DESC);
    CREATE INDEX IF NOT EXISTS idx_svc_dashboard_sss_sampled
      ON svc_dashboard_service_status_samples(sampled_at DESC);
    CREATE INDEX IF NOT EXISTS idx_svc_dashboard_ssms_service_label_sampled
      ON svc_dashboard_service_status_metric_samples(service_id, label, sampled_at DESC);
    CREATE INDEX IF NOT EXISTS idx_svc_dashboard_ssms_sample
      ON svc_dashboard_service_status_metric_samples(status_sample_id);
    CREATE INDEX IF NOT EXISTS idx_svc_dashboard_sws_service_sampled
      ON svc_dashboard_service_work_samples(service_id, sampled_at DESC);
    CREATE INDEX IF NOT EXISTS idx_svc_dashboard_sws_sampled
      ON svc_dashboard_service_work_samples(sampled_at DESC);
  `);

  const columns = db.pragma('table_info(svc_dashboard_service_status_samples)') as { name: string }[];
  if (!columns.some((column) => column.name === 'open_prs')) {
    db.exec('ALTER TABLE svc_dashboard_service_status_samples ADD COLUMN open_prs INTEGER');
  }
  if (!columns.some((column) => column.name === 'linear_total')) {
    db.exec('ALTER TABLE svc_dashboard_service_status_samples ADD COLUMN linear_total INTEGER');
  }
}

function numericMetricValue(value: number | string): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function serviceWorkValue(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseStoredMetricValue(valueJson: string): number | string {
  try {
    const parsed = JSON.parse(valueJson) as unknown;
    if (typeof parsed === 'number' && Number.isFinite(parsed)) {
      return parsed;
    }

    if (typeof parsed === 'string') {
      return parsed;
    }
  } catch {
    return valueJson;
  }

  return valueJson;
}

function sampleServiceStatuses(dbPath: string, results: ServiceStatusResult[]): void {
  withServiceHistoryDb<void>(dbPath, undefined, (db) => {
    const sampledAt = new Date().toISOString();
    const retentionCutoff = new Date(Date.now() - SERVICE_HISTORY_RETENTION_MS).toISOString();
    const insertStatus = db.prepare(`
      INSERT INTO svc_dashboard_service_status_samples (
        service_id,
        service_name,
        base_url,
        health_endpoint,
        status,
        response_time_ms,
        open_prs,
        linear_total,
        error,
        checked_at,
        sampled_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMetric = db.prepare(`
      INSERT INTO svc_dashboard_service_status_metric_samples (
        status_sample_id,
        service_id,
        label,
        value_json,
        numeric_value,
        tone,
        sampled_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertWork = db.prepare(`
      INSERT INTO svc_dashboard_service_work_samples (
        service_id,
        service_name,
        open_prs,
        linear_total,
        source,
        sampled_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(service_id, sampled_at, source) DO UPDATE SET
        service_name = excluded.service_name,
        open_prs = COALESCE(excluded.open_prs, svc_dashboard_service_work_samples.open_prs),
        linear_total = COALESCE(excluded.linear_total, svc_dashboard_service_work_samples.linear_total),
        updated_at = excluded.updated_at
    `);
    const prune = db.transaction(() => {
      db.prepare('DELETE FROM svc_dashboard_service_status_metric_samples WHERE sampled_at < ?').run(retentionCutoff);
      db.prepare('DELETE FROM svc_dashboard_service_status_samples WHERE sampled_at < ?').run(retentionCutoff);
      db.prepare('DELETE FROM svc_dashboard_service_work_samples WHERE sampled_at < ?').run(retentionCutoff);
    });
    const insertAll = db.transaction((services: ServiceStatusResult[]) => {
      for (const service of services) {
        const openPrs = serviceWorkValue(service.work?.pullRequests?.open);
        const linearTotal = serviceWorkValue(service.work?.linear?.total);
        const statusResult = insertStatus.run(
          service.id,
          service.name,
          service.baseUrl,
          service.healthEndpoint,
          service.status,
          service.responseTimeMs,
          openPrs,
          linearTotal,
          service.error ?? null,
          service.checkedAt,
          sampledAt,
        );
        const sampleId = Number(statusResult.lastInsertRowid);

        if (openPrs !== null || linearTotal !== null) {
          insertWork.run(
            service.id,
            service.name,
            openPrs,
            linearTotal,
            'live',
            sampledAt,
            sampledAt,
          );
        }

        for (const metric of service.metrics) {
          insertMetric.run(
            sampleId,
            service.id,
            metric.label,
            JSON.stringify(metric.value),
            numericMetricValue(metric.value),
            metric.tone ?? null,
            sampledAt,
          );
        }
      }
    });

    prune();
    insertAll(results);
  });
}

function parseDateMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function earliestDateMs(values: Array<string | null | undefined>): number | null {
  let earliest: number | null = null;

  for (const value of values) {
    const parsed = parseDateMs(value);
    if (parsed === null) continue;
    earliest = earliest === null ? parsed : Math.min(earliest, parsed);
  }

  return earliest;
}

function historyBucketMs(range: ServiceHistoryRange): number {
  return range === '24h' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
}

function buildBackfillBuckets(range: ServiceHistoryRange, now: Date): Date[] {
  const bucketMs = historyBucketMs(range);
  const { from } = getHistoryWindow(range, now);
  const fromMs = parseDateMs(from) ?? now.getTime();
  const startMs = Math.ceil(fromMs / bucketMs) * bucketMs;
  const endMs = Math.floor(now.getTime() / bucketMs) * bucketMs;
  const buckets: Date[] = [];

  for (let ms = startMs; ms <= endMs; ms += bucketMs) {
    buckets.push(new Date(ms));
  }

  return buckets.length > 0 ? buckets : [now];
}

function parseGithubPullRequestFact(value: unknown): GithubPullRequestFact | null {
  if (!isRecord(value)) return null;

  const rawId = value.id;
  const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : null;
  const openedAt = getString(value.created_at);

  if (!id || !openedAt || parseDateMs(openedAt) === null) {
    return null;
  }

  return {
    id,
    number: getNumber(value.number),
    openedAt,
    updatedAt: getString(value.updated_at),
    closedAt: getString(value.closed_at),
    state: getString(value.state),
  };
}

async function fetchGithubPullRequestPage(
  repo: string,
  state: 'all' | 'open',
  sort: 'created' | 'updated',
  direction: 'asc' | 'desc',
  page: number,
): Promise<{ facts: GithubPullRequestFact[]; error?: string }> {
  const [owner, repoName, extra] = repo.split('/');
  if (!owner || !repoName || extra) {
    return { facts: [], error: 'GitHub repo must be owner/name' };
  }

  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const url = new URL(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/pulls`);
  url.searchParams.set('state', state);
  url.searchParams.set('sort', sort);
  url.searchParams.set('direction', direction);
  url.searchParams.set('per_page', String(GITHUB_BACKFILL_PAGE_LIMIT));
  url.searchParams.set('page', String(page));

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dashboard-service-status',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url.toString(), {
    headers,
    signal: AbortSignal.timeout(SERVICE_WORK_TIMEOUT_MS),
  });
  const payload = await tryReadJson(response);

  if (!response.ok) {
    return { facts: [], error: getApiErrorMessage(payload) ?? `HTTP ${response.status}` };
  }

  if (!Array.isArray(payload)) {
    return { facts: [], error: 'Unexpected GitHub response' };
  }

  return {
    facts: payload.flatMap((item) => {
      const fact = parseGithubPullRequestFact(item);
      return fact ? [fact] : [];
    }),
  };
}

async function fetchGithubPullRequestFacts(
  repo: string,
  from: Date,
  to: Date,
): Promise<{ facts: GithubPullRequestFact[]; error?: string }> {
  const facts = new Map<string, GithubPullRequestFact>();
  const fromMs = from.getTime();
  const toMs = to.getTime();

  try {
    for (let page = 1; page <= GITHUB_BACKFILL_MAX_PAGES; page += 1) {
      const result = await fetchGithubPullRequestPage(repo, 'all', 'updated', 'desc', page);
      if (result.error) {
        return { facts: [], error: result.error };
      }

      for (const fact of result.facts) {
        facts.set(fact.id, fact);
      }

      const oldestUpdatedMs = earliestDateMs(result.facts.map((fact) => fact.updatedAt ?? fact.openedAt));
      if (result.facts.length < GITHUB_BACKFILL_PAGE_LIMIT || (oldestUpdatedMs !== null && oldestUpdatedMs < fromMs)) {
        break;
      }
    }

    for (let page = 1; page <= GITHUB_BACKFILL_MAX_PAGES; page += 1) {
      const result = await fetchGithubPullRequestPage(repo, 'open', 'created', 'asc', page);
      if (result.error) {
        return { facts: [], error: result.error };
      }

      for (const fact of result.facts) {
        facts.set(fact.id, fact);
      }

      if (result.facts.length < GITHUB_BACKFILL_PAGE_LIMIT) {
        break;
      }
    }
  } catch (error) {
    return { facts: [], error: formatExternalError(error) };
  }

  return {
    facts: Array.from(facts.values()).filter((fact) => {
      const openedMs = parseDateMs(fact.openedAt);
      const closedMs = parseDateMs(fact.closedAt);
      return openedMs !== null && openedMs <= toMs && (closedMs === null || closedMs > fromMs);
    }),
  };
}

function countGithubOpenAt(facts: GithubPullRequestFact[], at: Date): number {
  const atMs = at.getTime();

  return facts.filter((fact) => {
    const openedMs = parseDateMs(fact.openedAt);
    const closedMs = parseDateMs(fact.closedAt);
    return openedMs !== null && openedMs <= atMs && (closedMs === null || closedMs > atMs);
  }).length;
}

function parseLinearBackfillIssueFact(value: unknown): LinearBackfillIssueFact | null {
  if (!isRecord(value)) return null;

  const id = getString(value.id);
  const openedAt = getString(value.createdAt);
  if (!id || !openedAt || parseDateMs(openedAt) === null) {
    return null;
  }

  const state = isRecord(value.state) ? value.state : undefined;

  return {
    id,
    identifier: getString(value.identifier),
    number: getNumber(value.number),
    openedAt,
    completedAt: getString(value.completedAt),
    canceledAt: getString(value.canceledAt),
    archivedAt: getString(value.archivedAt),
    updatedAt: getString(value.updatedAt),
    currentStateName: getString(state?.name),
    stateType: getString(state?.type),
  };
}

function parseLinearBackfillIssuePage(payload: unknown): LinearBackfillIssuePage | null {
  if (!isRecord(payload) || !isRecord(payload.data) || !isRecord(payload.data.issues)) {
    return null;
  }

  const { pageInfo, nodes } = payload.data.issues;
  if (!isRecord(pageInfo) || !Array.isArray(nodes)) {
    return null;
  }

  return {
    facts: nodes.flatMap((node) => {
      const fact = parseLinearBackfillIssueFact(node);
      return fact ? [fact] : [];
    }),
    hasNextPage: pageInfo.hasNextPage === true,
    endCursor: getString(pageInfo.endCursor),
  };
}

async function fetchLinearBackfillFacts(
  project: string,
  from: Date,
  to: Date,
): Promise<{ facts: LinearBackfillIssueFact[]; error?: string }> {
  const token = process.env.LINEAR_API_KEY;
  if (!token) {
    return { facts: [], error: 'LINEAR_API_KEY not configured' };
  }

  const facts = new Map<string, LinearBackfillIssueFact>();
  const fromMs = from.getTime();
  const toMs = to.getTime();
  let after: string | null = null;
  let page = 0;
  let query = LINEAR_ISSUE_BACKFILL_QUERY;
  let triedFallback = false;

  try {
    while (page < LINEAR_ISSUE_MAX_PAGES) {
      const response = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          variables: { projectName: project, first: LINEAR_ISSUE_PAGE_LIMIT, after },
        }),
        signal: AbortSignal.timeout(SERVICE_WORK_TIMEOUT_MS),
      });
      const payload = await tryReadJson(response);

      if (!response.ok) {
        return { facts: [], error: getApiErrorMessage(payload) ?? `HTTP ${response.status}` };
      }

      const apiError = getApiErrorMessage(payload);
      if (apiError) {
        if (!triedFallback) {
          triedFallback = true;
          query = LINEAR_ISSUE_BACKFILL_FALLBACK_QUERY;
          after = null;
          page = 0;
          facts.clear();
          continue;
        }

        return { facts: [], error: apiError };
      }

      const issuePage = parseLinearBackfillIssuePage(payload);
      if (!issuePage) {
        return { facts: [], error: 'Unexpected Linear response' };
      }

      for (const fact of issuePage.facts) {
        facts.set(fact.id, fact);
      }

      if (!issuePage.hasNextPage) break;
      after = issuePage.endCursor;

      if (!after) {
        return { facts: [], error: 'Linear pagination cursor missing' };
      }

      page += 1;
    }
  } catch (error) {
    return { facts: [], error: formatExternalError(error) };
  }

  return {
    facts: Array.from(facts.values()).filter((fact) => {
      const openedMs = parseDateMs(fact.openedAt);
      const closedMs = linearTerminalMs(fact);
      return openedMs !== null && openedMs <= toMs && (closedMs === null || closedMs > fromMs);
    }),
  };
}

function linearTerminalMs(fact: LinearBackfillIssueFact): number | null {
  return earliestDateMs([
    fact.completedAt,
    fact.canceledAt,
    fact.archivedAt,
    isClosedLinearStateType(fact.stateType) ? fact.updatedAt : null,
  ]);
}

function countLinearOpenAt(facts: LinearBackfillIssueFact[], at: Date): number {
  const atMs = at.getTime();

  return facts.filter((fact) => {
    const openedMs = parseDateMs(fact.openedAt);
    const closedMs = linearTerminalMs(fact);
    return openedMs !== null && openedMs <= atMs && (closedMs === null || closedMs > atMs);
  }).length;
}

function persistServiceWorkSamples(dbPath: string, samples: ServiceWorkSampleInsert[]): number {
  if (samples.length === 0) return 0;

  return withServiceHistoryDb<number>(dbPath, -1, (db) => {
    const insertWork = db.prepare(`
      INSERT INTO svc_dashboard_service_work_samples (
        service_id,
        service_name,
        open_prs,
        linear_total,
        source,
        sampled_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(service_id, sampled_at, source) DO UPDATE SET
        service_name = excluded.service_name,
        open_prs = COALESCE(excluded.open_prs, svc_dashboard_service_work_samples.open_prs),
        linear_total = COALESCE(excluded.linear_total, svc_dashboard_service_work_samples.linear_total),
        updated_at = excluded.updated_at
    `);
    const updatedAt = new Date().toISOString();
    const insertAll = db.transaction((rows: ServiceWorkSampleInsert[]) => {
      for (const sample of rows) {
        insertWork.run(
          sample.serviceId,
          sample.serviceName,
          sample.openPrs,
          sample.linearTotal,
          sample.source,
          sample.sampledAt,
          updatedAt,
        );
      }
    });

    insertAll(samples);
    return samples.length;
  });
}

function thinRows<T>(rows: T[], limit: number): T[] {
  if (rows.length <= limit) {
    return rows;
  }

  const thinned: T[] = [];
  const lastIndex = rows.length - 1;

  for (let index = 0; index < limit; index += 1) {
    thinned.push(rows[Math.round((index * lastIndex) / (limit - 1))]);
  }

  return thinned;
}

function toHistorySamples(rows: ServiceHistoryStatusRow[]): ServiceHistorySample[] {
  return rows.map((row) => ({
    checkedAt: row.checked_at,
    status: row.status,
    responseTimeMs: row.response_time_ms,
    openPrs: row.open_prs,
    linearTotal: row.linear_total,
    ...(row.error ? { error: row.error } : {}),
  }));
}

function toWorkSamples(rows: ServiceHistoryWorkRow[]): ServiceWorkHistorySample[] {
  return rows.map((row) => ({
    checkedAt: row.sampled_at,
    openPrs: row.open_prs,
    linearTotal: row.linear_total,
  }));
}

function toMetricSeries(rows: ServiceHistoryMetricRow[]): ServiceMetricSeries[] {
  const byLabel = new Map<string, ServiceMetricSeries>();

  for (const row of rows) {
    const value = parseStoredMetricValue(row.value_json);
    const point: ServiceMetricPoint = {
      checkedAt: row.sampled_at,
      value,
      ...(row.numeric_value === null ? {} : { numericValue: row.numeric_value }),
    };
    const existing = byLabel.get(row.label);

    if (existing) {
      if (row.tone) {
        existing.tone = row.tone;
      }
      existing.points.push(point);
      continue;
    }

    byLabel.set(row.label, {
      label: row.label,
      ...(row.tone ? { tone: row.tone } : {}),
      points: [point],
    });
  }

  return Array.from(byLabel.values())
    .map((series) => ({
      ...series,
      points: thinRows(series.points, SERVICE_HISTORY_SAMPLE_LIMIT),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function isIncidentStatus(status: ServiceStatus): status is Exclude<ServiceStatus, 'healthy'> {
  return status !== 'healthy';
}

function incidentStatusPriority(status: Exclude<ServiceStatus, 'healthy'>): number {
  if (status === 'unhealthy') return 3;
  if (status === 'timeout') return 2;
  return 1;
}

function toIncidents(rows: ServiceHistoryStatusRow[]): ServiceIncident[] {
  const incidents: ServiceIncident[] = [];
  let current: ServiceIncident | null = null;

  for (const row of rows) {
    if (!isIncidentStatus(row.status)) {
      if (current) {
        current.endedAt = row.checked_at;
        incidents.push(current);
        current = null;
      }
      continue;
    }

    if (!current) {
      current = {
        startedAt: row.checked_at,
        endedAt: null,
        status: row.status,
        sampleCount: 1,
        ...(row.error ? { lastError: row.error } : {}),
      };
      continue;
    }

    current.sampleCount += 1;
    if (incidentStatusPriority(row.status) > incidentStatusPriority(current.status)) {
      current.status = row.status;
    }
    if (row.error) {
      current.lastError = row.error;
    }
  }

  if (current) {
    incidents.push(current);
  }

  return incidents.slice(-SERVICE_HISTORY_INCIDENT_LIMIT).reverse();
}

function readServiceHistories(
  dbPath: string,
  serviceIds: string[],
  range: ServiceHistoryRange,
): Map<string, ServiceStatusHistory> {
  const { from, to } = getHistoryWindow(range);
  const fallback = new Map(
    serviceIds.map((serviceId) => [serviceId, emptyServiceHistory(range, from, to)]),
  );

  return withServiceHistoryDb(dbPath, fallback, (db) => {
    const histories = new Map<string, ServiceStatusHistory>();
    const selectStatuses = db.prepare(`
      SELECT checked_at, status, response_time_ms, open_prs, linear_total, error
      FROM (
        SELECT checked_at, status, response_time_ms, open_prs, linear_total, error, sampled_at
        FROM svc_dashboard_service_status_samples
        WHERE service_id = ? AND sampled_at >= ? AND sampled_at <= ?
        ORDER BY sampled_at DESC
        LIMIT ${SERVICE_HISTORY_RAW_ROW_LIMIT}
      )
      ORDER BY sampled_at ASC
    `);
    const selectMetrics = db.prepare(`
      SELECT label, value_json, numeric_value, tone, sampled_at
      FROM (
        SELECT label, value_json, numeric_value, tone, sampled_at
        FROM svc_dashboard_service_status_metric_samples
        WHERE service_id = ? AND sampled_at >= ? AND sampled_at <= ?
        ORDER BY sampled_at DESC
        LIMIT ${SERVICE_HISTORY_RAW_ROW_LIMIT}
      )
      ORDER BY sampled_at ASC
    `);
    const selectWorkSamples = db.prepare(`
      SELECT sampled_at, open_prs, linear_total
      FROM (
        SELECT sampled_at, open_prs, linear_total
        FROM svc_dashboard_service_work_samples
        WHERE service_id = ? AND sampled_at >= ? AND sampled_at <= ?
        ORDER BY sampled_at DESC
        LIMIT ${SERVICE_HISTORY_RAW_ROW_LIMIT}
      )
      ORDER BY sampled_at ASC
    `);

    for (const serviceId of serviceIds) {
      const statusRows = selectStatuses.all(serviceId, from, to) as ServiceHistoryStatusRow[];
      const metricRows = selectMetrics.all(serviceId, from, to) as ServiceHistoryMetricRow[];
      const workRows = selectWorkSamples.all(serviceId, from, to) as ServiceHistoryWorkRow[];

      histories.set(serviceId, {
        range,
        from,
        to,
        samples: toHistorySamples(thinRows(statusRows, SERVICE_HISTORY_SAMPLE_LIMIT)),
        workSamples: toWorkSamples(thinRows(workRows, SERVICE_HISTORY_SAMPLE_LIMIT)),
        metricSeries: toMetricSeries(metricRows),
        incidents: toIncidents(statusRows),
      });
    }

    return histories;
  });
}

export async function backfillServiceWorkHistory(
  options: ServiceWorkHistoryBackfillOptions = {},
): Promise<ServiceWorkHistoryBackfillResult> {
  const configPath = options.configPath ?? process.env.HERMES_CONFIG_PATH ?? DEFAULT_HERMES_CONFIG_PATH;
  const hopperDbPath = options.hopperDbPath ?? process.env.HOPPER_DB_PATH ?? DEFAULT_HOPPER_DB_PATH;
  const range = options.range ?? '30d';
  const now = options.now ?? new Date();
  const { from, to } = getHistoryWindow(range, now);
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const buckets = buildBackfillBuckets(range, now);
  const definitions = await loadServiceDefinitions(configPath);
  const serviceResults: ServiceWorkHistoryBackfillServiceResult[] = [];
  const samples: ServiceWorkSampleInsert[] = [];

  for (const service of definitions) {
    if (!service.githubRepo && !service.linearProject) {
      continue;
    }

    const [githubFacts, linearFacts] = await Promise.all([
      service.githubRepo
        ? fetchGithubPullRequestFacts(service.githubRepo, fromDate, toDate)
        : Promise.resolve(undefined),
      service.linearProject
        ? fetchLinearBackfillFacts(service.linearProject, fromDate, toDate)
        : Promise.resolve(undefined),
    ]);
    const githubCounts = githubFacts && !githubFacts.error
      ? buckets.map((bucket) => countGithubOpenAt(githubFacts.facts, bucket))
      : null;
    const linearCounts = linearFacts && !linearFacts.error
      ? buckets.map((bucket) => countLinearOpenAt(linearFacts.facts, bucket))
      : null;

    for (const [index, bucket] of buckets.entries()) {
      const openPrs = githubCounts?.[index] ?? null;
      const linearTotal = linearCounts?.[index] ?? null;
      if (openPrs === null && linearTotal === null) {
        continue;
      }

      samples.push({
        serviceId: service.id,
        serviceName: service.name,
        openPrs,
        linearTotal,
        sampledAt: bucket.toISOString(),
        source: 'backfill',
      });
    }

    serviceResults.push({
      serviceId: service.id,
      serviceName: service.name,
      ...(service.githubRepo
        ? {
          github: {
            scope: service.githubRepo,
            itemCount: githubFacts && !githubFacts.error ? githubFacts.facts.length : 0,
            pointCount: githubCounts ? githubCounts.length : 0,
            ...(githubFacts?.error ? { error: githubFacts.error } : {}),
          },
        }
        : {}),
      ...(service.linearProject
        ? {
          linear: {
            scope: service.linearProject,
            itemCount: linearFacts && !linearFacts.error ? linearFacts.facts.length : 0,
            pointCount: linearCounts ? linearCounts.length : 0,
            ...(linearFacts?.error ? { error: linearFacts.error } : {}),
          },
        }
        : {}),
    });
  }

  const written = persistServiceWorkSamples(hopperDbPath, samples);
  if (written < 0) {
    throw new Error('Failed to write service work history');
  }

  return {
    range,
    from,
    to,
    bucketHours: historyBucketMs(range) / 3600000,
    generatedAt: new Date().toISOString(),
    services: serviceResults,
  };
}

export async function getServiceStatuses(options: ServiceStatusOptions = {}): Promise<ServiceStatusResult[]> {
  const configPath = options.configPath ?? process.env.HERMES_CONFIG_PATH ?? DEFAULT_HERMES_CONFIG_PATH;
  const hopperDbPath = options.hopperDbPath ?? process.env.HOPPER_DB_PATH ?? DEFAULT_HOPPER_DB_PATH;
  const loggerDbPath = options.loggerDbPath ?? process.env.LOGGER_DB_PATH ?? DEFAULT_LOGGER_DB_PATH;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const historyRange = options.historyRange ?? SERVICE_HISTORY_DEFAULT_RANGE;
  const definitions = await loadServiceDefinitions(configPath);

  const results = await Promise.all(
    definitions.map(async (definition) => {
      const definitionWithTimeout = {
        ...definition,
        healthTimeout: definition.healthTimeout || timeoutMs,
      };
      const [base, work] = await Promise.all([
        checkServiceHealth(definitionWithTimeout),
        fetchServiceWorkSummary(definition),
      ]);
      const withMetrics = attachLocalMetrics(base, { hopperDbPath, loggerDbPath });

      return work ? { ...withMetrics, work } : withMetrics;
    }),
  );

  sampleServiceStatuses(hopperDbPath, results);
  const histories = readServiceHistories(hopperDbPath, results.map((service) => service.id), historyRange);
  const fallbackWindow = getHistoryWindow(historyRange);

  return results.map((service) => ({
    ...service,
    history: histories.get(service.id) ?? emptyServiceHistory(historyRange, fallbackWindow.from, fallbackWindow.to),
  }));
}
