import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  GitPullRequest,
  RefreshCw,
  Server,
  Ticket,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { config } from '@/config';

type ServiceStatus = 'healthy' | 'unhealthy' | 'timeout' | 'unknown';
type HistoryRangeHours = 24 | 168 | 720;

interface ServiceMetric {
  label: string;
  value: number | string;
  tone?: 'default' | 'good' | 'warning' | 'danger';
}

interface ServicePullRequestSummary {
  repo: string;
  open: number | null;
  error?: string;
}

interface ServiceLinearStateCount {
  state: string;
  count: number;
}

interface ServiceLinearSummary {
  project: string;
  states: ServiceLinearStateCount[];
  total: number | null;
  error?: string;
}

interface ServiceWorkSummary {
  pullRequests?: ServicePullRequestSummary;
  linear?: ServiceLinearSummary;
}

interface ServiceStatusResult {
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
  history?: unknown;
}

interface ServicesResponse {
  success: boolean;
  data: ServiceStatusResult[];
  history?: unknown;
}

interface ServiceHistorySample {
  sampledAt: string;
  status: ServiceStatus;
  responseTimeMs: number | null;
  openPrs: number | null;
  linearTotal: number | null;
  error?: string;
}

interface ServiceWorkSample {
  sampledAt: string;
  openPrs: number | null;
  linearTotal: number | null;
}

interface ServiceMetricPoint {
  sampledAt: string;
  value: number | string;
}

interface ServiceMetricSeries {
  label: string;
  tone?: ServiceMetric['tone'];
  points: ServiceMetricPoint[];
}

interface ServiceIncident {
  serviceId: string;
  status: Exclude<ServiceStatus, 'healthy'>;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
  error?: string;
}

interface ServiceHistoryEntry {
  serviceId: string;
  serviceName: string;
  uptimePct: number | null;
  lastDownAt: string | null;
  samples: ServiceHistorySample[];
  workSamples?: ServiceWorkSample[];
  incidents: ServiceIncident[];
  metricSeries: ServiceMetricSeries[];
}

interface ServiceHistorySnapshot {
  rangeHours: number;
  generatedAt: string;
  services: Record<string, ServiceHistoryEntry>;
}

interface ServicesHistoryResponse {
  success: boolean;
  data: ServiceHistorySnapshot;
}

const historyRanges: Array<{ label: string; value: HistoryRangeHours }> = [
  { label: '24h', value: 24 },
  { label: '7d', value: 168 },
  { label: '30d', value: 720 },
];

const statusMeta: Record<
  ServiceStatus,
  { label: string; className: string; badgeClassName: string; railClassName: string; icon: typeof CheckCircle2 }
> = {
  healthy: {
    label: 'Up',
    className: 'text-emerald-600 dark:text-emerald-400',
    badgeClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
    railClassName: 'bg-emerald-500',
    icon: CheckCircle2,
  },
  unhealthy: {
    label: 'Down',
    className: 'text-red-600 dark:text-red-400',
    badgeClassName: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300',
    railClassName: 'bg-red-500',
    icon: XCircle,
  },
  timeout: {
    label: 'Slow',
    className: 'text-amber-600 dark:text-amber-400',
    badgeClassName: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
    railClassName: 'bg-amber-500',
    icon: AlertTriangle,
  },
  unknown: {
    label: 'Unknown',
    className: 'text-muted-foreground',
    badgeClassName: 'border-border bg-muted text-muted-foreground',
    railClassName: 'bg-muted-foreground',
    icon: AlertTriangle,
  },
};

const statusWeight: Record<ServiceStatus, number> = {
  unhealthy: 0,
  timeout: 1,
  unknown: 2,
  healthy: 3,
};

function formatCheckedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatActivity(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const diffMs = Date.now() - date.getTime();
  const diffHours = Math.floor(diffMs / 3600000);
  if (diffHours < 1) return 'active now';
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatDuration(minutes: number | null): string {
  if (minutes === null) return 'ongoing';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining === 0 ? `${hours}h` : `${hours}h ${remaining}m`;
}

function metricClassName(tone: ServiceMetric['tone']): string {
  switch (tone) {
    case 'good':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'warning':
      return 'text-amber-600 dark:text-amber-400';
    case 'danger':
      return 'text-red-600 dark:text-red-400';
    default:
      return 'text-foreground';
  }
}

function formatUnavailable(error?: string): string {
  return error || 'Not configured';
}

function tooltipPositionClassName(align: 'left' | 'center' | 'right'): string {
  switch (align) {
    case 'left':
      return 'left-0';
    case 'right':
      return 'right-0';
    default:
      return 'left-1/2 -translate-x-1/2';
  }
}

function IconHint({
  icon: Icon,
  label,
  className = 'h-4 w-4',
  align = 'center',
}: {
  icon: LucideIcon;
  label: string;
  className?: string;
  align?: 'left' | 'center' | 'right';
}) {
  return (
    <span
      aria-label={label}
      className="group/hint relative inline-flex shrink-0 items-center"
      tabIndex={0}
    >
      <Icon aria-hidden="true" className={className} />
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute top-full z-20 mt-1 hidden w-72 max-w-[calc(100vw-2rem)] whitespace-normal break-words rounded border bg-popover px-2.5 py-1.5 text-left text-[11px] font-normal leading-snug text-popover-foreground shadow-md sm:w-96 group-hover/hint:block group-focus-visible/hint:block ${tooltipPositionClassName(align)}`}
      >
        {label}
      </span>
    </span>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function getNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.trim().length === 0) return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeUptimePct(value: unknown): number | null {
  const raw = getNumber(value);
  if (raw === null) return null;
  const pct = raw > 0 && raw <= 1 ? raw * 100 : raw;
  return Math.max(0, Math.min(100, pct));
}

function normalizeHistoryStatus(value: unknown, record?: Record<string, unknown>): ServiceStatus {
  if (value === 'healthy' || value === 'unhealthy' || value === 'timeout' || value === 'unknown') {
    return value;
  }

  if (record?.ok === true || record?.healthy === true) return 'healthy';
  if (record?.ok === false || record?.healthy === false) return 'unhealthy';

  return 'unknown';
}

function historyItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];

  for (const key of ['samples', 'points', 'entries', 'checks', 'items', 'data']) {
    const items = value[key];
    if (Array.isArray(items)) return items;
  }

  return [];
}

function normalizeHistorySample(value: unknown): ServiceHistorySample | null {
  if (!isRecord(value)) return null;

  const sampledAt =
    getString(value.sampledAt) ??
    getString(value.checkedAt) ??
    getString(value.timestamp) ??
    getString(value.time) ??
    getString(value.at) ??
    '';

  return {
    sampledAt,
    status: normalizeHistoryStatus(value.status ?? value.state, value),
    responseTimeMs: getNumber(value.responseTimeMs ?? value.latencyMs ?? value.durationMs),
    openPrs: getNumber(value.openPrs ?? value.openPullRequests ?? value.pullRequests ?? value.prs),
    linearTotal: getNumber(value.linearTotal ?? value.openTickets ?? value.tickets),
    error: getString(value.error) ?? undefined,
  };
}

function normalizeWorkSample(value: unknown): ServiceWorkSample | null {
  if (!isRecord(value)) return null;

  const sampledAt =
    getString(value.sampledAt) ??
    getString(value.checkedAt) ??
    getString(value.timestamp) ??
    getString(value.time) ??
    getString(value.at);
  if (!sampledAt) return null;

  return {
    sampledAt,
    openPrs: getNumber(value.openPrs),
    linearTotal: getNumber(value.linearTotal),
  };
}

function normalizeMetricSeries(value: unknown): ServiceMetricSeries[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const label = getString(item.label);
    if (!label) return [];

    const points = historyItems(item).flatMap((point) => {
      if (!isRecord(point)) return [];
      const sampledAt =
        getString(point.sampledAt) ??
        getString(point.checkedAt) ??
        getString(point.timestamp) ??
        getString(point.time) ??
        getString(point.at);
      const metricValue = point.value;

      return sampledAt && (typeof metricValue === 'number' || typeof metricValue === 'string')
        ? [{ sampledAt, value: metricValue }]
        : [];
    });

    return [{
      label,
      tone: item.tone === 'good' || item.tone === 'warning' || item.tone === 'danger' || item.tone === 'default'
        ? item.tone
        : undefined,
      points,
    }];
  });
}

function normalizeIncident(value: unknown, service: ServiceStatusResult): ServiceIncident | null {
  if (!isRecord(value)) return null;
  const startedAt = getString(value.startedAt) ?? getString(value.startAt) ?? getString(value.timestamp);
  if (!startedAt) return null;

  const status = normalizeHistoryStatus(value.status ?? value.state, value);
  if (status === 'healthy') return null;

  return {
    serviceId: getString(value.serviceId) ?? getString(value.service) ?? service.id,
    status,
    startedAt,
    endedAt: getString(value.endedAt) ?? getString(value.endAt),
    durationMinutes: getNumber(value.durationMinutes ?? value.durationMins ?? value.minutes),
    error: getString(value.error) ?? undefined,
  };
}

function computedUptimePct(samples: ServiceHistorySample[]): number | null {
  if (samples.length === 0) return null;
  const healthy = samples.filter((sample) => sample.status === 'healthy').length;
  return Math.round((healthy / samples.length) * 1000) / 10;
}

function latestDownAt(samples: ServiceHistorySample[]): string | null {
  return [...samples]
    .reverse()
    .find((sample) => sample.status === 'unhealthy' || sample.status === 'timeout')
    ?.sampledAt ?? null;
}

function normalizeHistoryEntry(
  value: unknown,
  service: ServiceStatusResult,
  fallback?: unknown,
): ServiceHistoryEntry | null {
  if (value === undefined || value === null) return null;

  const record = isRecord(value) ? value : undefined;
  const fallbackRecord = isRecord(fallback) ? fallback : undefined;
  const samples = historyItems(value).flatMap((item) => {
    const sample = normalizeHistorySample(item);
    return sample ? [sample] : [];
  });
  const workSamples = Array.isArray(record?.workSamples)
    ? record.workSamples.flatMap((item) => {
      const sample = normalizeWorkSample(item);
      return sample ? [sample] : [];
    })
    : [];
  const incidents = Array.isArray(record?.incidents)
    ? record.incidents.flatMap((incident) => {
      const normalized = normalizeIncident(incident, service);
      return normalized ? [normalized] : [];
    })
    : [];
  const metricSeries = normalizeMetricSeries(record?.metricSeries);
  const uptimePct =
    normalizeUptimePct(record?.uptimePct ?? record?.uptimePercent ?? record?.uptimePercentage ?? record?.uptime) ??
    normalizeUptimePct(fallbackRecord?.uptimePct ?? fallbackRecord?.uptimePercent ?? fallbackRecord?.uptime) ??
    computedUptimePct(samples);

  if (samples.length === 0 && workSamples.length === 0 && incidents.length === 0 && metricSeries.length === 0 && uptimePct === null) {
    return null;
  }

  return {
    serviceId: getString(record?.serviceId) ?? service.id,
    serviceName: getString(record?.serviceName) ?? getString(record?.name) ?? service.name,
    uptimePct,
    lastDownAt: getString(record?.lastDownAt) ?? latestDownAt(samples),
    samples,
    workSamples,
    incidents,
    metricSeries,
  };
}

function historyValueForService(history: unknown, service: ServiceStatusResult): unknown {
  const payload = isRecord(history) && isRecord(history.data) ? history.data : history;
  if (!isRecord(payload)) return undefined;

  const direct = payload[service.id] ?? payload[service.name];
  if (direct !== undefined) return direct;

  for (const key of ['services', 'byService', 'serviceHistory', 'histories']) {
    const nested = payload[key];
    if (!isRecord(nested)) continue;

    const value = nested[service.id] ?? nested[service.name];
    if (value !== undefined) return value;
  }

  const sharedItems = historyItems(payload).filter((item) => {
    if (!isRecord(item)) return false;
    const id =
      getString(item.serviceId) ??
      getString(item.service) ??
      getString(item.id) ??
      getString(item.name);
    return id === service.id || id === service.name;
  });

  return sharedItems.length > 0 ? { ...payload, samples: sharedItems } : undefined;
}

function normalizeInlineHistory(
  services: ServiceStatusResult[],
  responseHistory: unknown,
): ServiceHistorySnapshot | null {
  const payload = isRecord(responseHistory) && isRecord(responseHistory.data)
    ? responseHistory.data
    : responseHistory;
  const payloadRecord = isRecord(payload) ? payload : undefined;
  const entries: Record<string, ServiceHistoryEntry> = {};

  for (const service of services) {
    const ownHistory = normalizeHistoryEntry(service.history, service, payload);
    const mappedHistory = ownHistory ?? normalizeHistoryEntry(
      historyValueForService(payload, service),
      service,
      payload,
    );

    if (mappedHistory) {
      entries[service.id] = mappedHistory;
    }
  }

  if (Object.keys(entries).length === 0) return null;

  return {
    rangeHours: getNumber(payloadRecord?.rangeHours ?? payloadRecord?.hours) ?? 24,
    generatedAt: getString(payloadRecord?.generatedAt) ?? new Date().toISOString(),
    services: entries,
  };
}

function isHistoryResponse(value: unknown): value is ServicesHistoryResponse {
  if (!isRecord(value) || value.success !== true || !isRecord(value.data)) return false;
  return isRecord(value.data.services);
}

function statusSegmentClassName(status: ServiceStatus): string {
  switch (status) {
    case 'healthy':
      return 'bg-emerald-500';
    case 'unhealthy':
      return 'bg-red-500';
    case 'timeout':
      return 'bg-amber-500';
    default:
      return 'bg-muted';
  }
}

function worstStatus(samples: ServiceHistorySample[]): ServiceStatus {
  if (samples.some((sample) => sample.status === 'unhealthy')) return 'unhealthy';
  if (samples.some((sample) => sample.status === 'timeout')) return 'timeout';
  if (samples.some((sample) => sample.status === 'unknown')) return 'unknown';
  if (samples.some((sample) => sample.status === 'healthy')) return 'healthy';
  return 'unknown';
}

function compactSamples(samples: ServiceHistorySample[], targetCount: number): ServiceHistorySample[] {
  if (samples.length <= targetCount) return samples;

  const bucketSize = Math.ceil(samples.length / targetCount);
  const compacted: ServiceHistorySample[] = [];
  for (let index = 0; index < samples.length; index += bucketSize) {
    const bucket = samples.slice(index, index + bucketSize);
    const last = bucket.at(-1);
    if (!last) continue;
    compacted.push({
      ...last,
      status: worstStatus(bucket),
      responseTimeMs: last.responseTimeMs,
      error: bucket.find((sample) => sample.error)?.error,
    });
  }

  return compacted;
}

function UptimeStrip({
  history,
  serviceName,
}: {
  history?: ServiceHistoryEntry;
  serviceName: string;
}) {
  const samples = compactSamples(history?.samples ?? [], 56);
  const label = history?.uptimePct === null || history?.uptimePct === undefined
    ? `${serviceName} has no recorded history yet.`
    : `${serviceName} uptime ${history.uptimePct}% over this range.`;

  if (samples.length === 0) {
    return (
      <div aria-label={label} role="img" className="flex h-8 min-w-0 items-center gap-0.5">
        {Array.from({ length: 28 }).map((_, index) => (
          <span key={index} className="h-5 flex-1 rounded-sm bg-muted" />
        ))}
      </div>
    );
  }

  return (
    <div aria-label={label} role="img" className="flex h-8 min-w-0 items-center gap-0.5">
      {samples.map((sample, index) => (
        <span
          key={`${sample.sampledAt}-${sample.status}-${index}`}
          className={`h-5 flex-1 rounded-sm ${statusSegmentClassName(sample.status)}`}
          title={`${formatDateTime(sample.sampledAt)}: ${statusMeta[sample.status].label}${sample.responseTimeMs === null ? '' : `, ${sample.responseTimeMs}ms`}`}
        />
      ))}
    </div>
  );
}

function numericPoints(points: ServiceMetricPoint[]): Array<{ sampledAt: string; value: number }> {
  return points.flatMap((point) => (
    typeof point.value === 'number' && Number.isFinite(point.value)
      ? [{ sampledAt: point.sampledAt, value: point.value }]
      : []
  ));
}

function Sparkline({
  label,
  points,
  className = 'text-foreground',
}: {
  label: string;
  points: Array<{ sampledAt: string; value: number }>;
  className?: string;
}) {
  if (points.length < 2) {
    return (
      <div className="flex h-8 items-center text-xs text-muted-foreground" aria-label={`${label} trend unavailable`}>
        No trend
      </div>
    );
  }

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const path = points
    .map((point, index) => {
      const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100;
      const y = 28 - ((point.value - min) / range) * 24 - 2;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg
      aria-label={`${label} trend from ${min} to ${max}`}
      className={`h-8 w-full ${className}`}
      preserveAspectRatio="none"
      role="img"
      viewBox="0 0 100 28"
    >
      <polyline
        fill="none"
        points={path}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function TrendCell({
  icon: Icon,
  label,
  value,
  points,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string | null;
  points: Array<{ sampledAt: string; value: number }>;
  tone?: ServiceMetric['tone'];
}) {
  return (
    <div className="min-w-0 px-1 py-1">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{label}</span>
        </div>
        <div className={`truncate text-sm font-semibold ${metricClassName(tone)}`}>
          {value ?? 'n/a'}
        </div>
      </div>
      <Sparkline label={label} points={points} className={metricClassName(tone)} />
    </div>
  );
}

function samplesToPoints(
  samples: ServiceHistorySample[] | undefined,
  key: 'responseTimeMs' | 'openPrs' | 'linearTotal',
): Array<{ sampledAt: string; value: number }> {
  return (samples ?? []).flatMap((sample) => {
    const value = sample[key];
    return typeof value === 'number' && Number.isFinite(value)
      ? [{ sampledAt: sample.sampledAt, value }]
      : [];
  });
}

function workSamplesToPoints(
  history: ServiceHistoryEntry | undefined,
  key: 'openPrs' | 'linearTotal',
): Array<{ sampledAt: string; value: number }> {
  const samples = history?.workSamples && history.workSamples.length > 0
    ? history.workSamples
    : history?.samples ?? [];

  return samples.flatMap((sample) => {
    const value = sample[key];
    return typeof value === 'number' && Number.isFinite(value)
      ? [{ sampledAt: sample.sampledAt, value }]
      : [];
  });
}

function SummaryTile({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  tone?: 'default' | 'good' | 'warning' | 'danger';
}) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className={`text-lg font-semibold ${metricClassName(tone)}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function ServiceRow({
  service,
  history,
}: {
  service: ServiceStatusResult;
  history?: ServiceHistoryEntry;
}) {
  const meta = statusMeta[service.status] ?? statusMeta.unknown;
  const StatusIcon = meta.icon;
  const activity = formatActivity(service.lastActivityAt);
  const statusHint = service.error
    ? `${service.name} is ${meta.label.toLowerCase()}: ${service.error}`
    : `${service.name} is ${meta.label.toLowerCase()}; latest check returned successfully.`;
  const checkedHint = `Last checked at ${formatCheckedAt(service.checkedAt)}. The service is probed every 15 seconds.`;
  const activityHint = activity
    ? `Last recorded local data activity was ${activity}.`
    : 'No recent local data activity timestamp is available.';
  const latestMetricSeries = new Map(history?.metricSeries.map((series) => [series.label, series]) ?? []);
  const recentIncidents = [...(history?.incidents ?? [])].reverse().slice(0, 4);

  return (
    <details className="group/service rounded-md border bg-card shadow-sm">
      <summary className="grid cursor-pointer list-none grid-cols-1 gap-3 px-3 py-3 marker:hidden md:grid-cols-[minmax(220px,1.2fr)_minmax(220px,1fr)_minmax(260px,1.4fr)] md:items-center xl:grid-cols-[minmax(220px,1.2fr)_minmax(220px,1fr)_minmax(260px,1.4fr)_minmax(8rem,max-content)]">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`mt-1 h-10 w-1.5 shrink-0 rounded-full ${meta.railClassName}`} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <IconHint
                align="left"
                className="h-4 w-4 text-muted-foreground"
                icon={Server}
                label={`Service endpoint for ${service.name}: ${service.baseUrl}${service.healthEndpoint}`}
              />
              <span className="truncate text-sm font-semibold">{service.name}</span>
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">{service.baseUrl}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <div className={`inline-flex items-center gap-1 rounded border px-2 py-1 font-medium ${meta.badgeClassName}`}>
              <IconHint align="left" className="h-3.5 w-3.5" icon={StatusIcon} label={statusHint} />
              {meta.label}
            </div>
          </div>
          <div>
            <div className="font-semibold text-foreground">
              {typeof service.responseTimeMs === 'number' ? `${service.responseTimeMs}ms` : 'n/a'}
            </div>
            <div className="text-muted-foreground">Latency</div>
          </div>
          <div>
            <div className="font-semibold text-foreground">
              {history?.uptimePct === null || history?.uptimePct === undefined ? 'n/a' : `${history.uptimePct}%`}
            </div>
            <div className="text-muted-foreground">Uptime</div>
          </div>
        </div>

        <UptimeStrip history={history} serviceName={service.name} />

        <div className="flex min-w-0 items-center justify-between gap-3 md:col-span-3 md:justify-end xl:col-span-1">
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <IconHint className="h-3 w-3" icon={Clock} label={checkedHint} />
              {formatCheckedAt(service.checkedAt)}
            </span>
            {activity && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <IconHint className="h-3 w-3" icon={Activity} label={activityHint} />
                <span className="truncate">{activity}</span>
              </span>
            )}
          </div>
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open/service:rotate-180" />
        </div>
      </summary>

      <div className="border-t px-3 pb-3 pt-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <TrendCell
              icon={Activity}
              label="Latency"
              points={samplesToPoints(history?.samples, 'responseTimeMs')}
              value={typeof service.responseTimeMs === 'number' ? `${service.responseTimeMs}ms` : null}
              tone={service.status === 'timeout' ? 'warning' : 'default'}
            />
            {service.work?.pullRequests && (
              <TrendCell
                icon={GitPullRequest}
                label={`Open PRs${service.work.pullRequests.repo ? ` / ${service.work.pullRequests.repo}` : ''}`}
                points={workSamplesToPoints(history, 'openPrs')}
                value={service.work.pullRequests.open === null
                  ? formatUnavailable(service.work.pullRequests.error)
                  : service.work.pullRequests.open}
              />
            )}
            {service.work?.linear && (
              <TrendCell
                icon={Ticket}
                label={`Linear${service.work.linear.project ? ` / ${service.work.linear.project}` : ''}`}
                points={workSamplesToPoints(history, 'linearTotal')}
                value={service.work.linear.total === null
                  ? formatUnavailable(service.work.linear.error)
                  : service.work.linear.total}
              />
            )}
            {service.metrics.slice(0, 4).map((metric) => {
              const series = latestMetricSeries.get(metric.label);
              return (
                <TrendCell
                  key={`${service.id}-${metric.label}`}
                  icon={Activity}
                  label={metric.label}
                  points={numericPoints(series?.points ?? [])}
                  value={metric.value}
                  tone={metric.tone}
                />
              );
            })}
          </div>

          <div className="px-1 py-1">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">Incidents</div>
              <div className="text-xs text-muted-foreground">
                {history?.lastDownAt ? `Last down ${formatDateTime(history.lastDownAt)}` : 'No recorded downtime'}
              </div>
            </div>
            {recentIncidents.length === 0 ? (
              <div className="mt-3 text-sm text-muted-foreground">No incidents in this range.</div>
            ) : (
              <div className="mt-3 space-y-2">
                {recentIncidents.map((incident) => (
                  <div key={`${incident.startedAt}-${incident.status}`} className="text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`font-medium ${statusMeta[incident.status].className}`}>
                        {statusMeta[incident.status].label}
                      </span>
                      <span className="text-muted-foreground">{formatDuration(incident.durationMinutes)}</span>
                    </div>
                    <div className="mt-0.5 truncate text-muted-foreground" title={incident.error}>
                      {formatDateTime(incident.startedAt)}
                      {incident.endedAt ? ` to ${formatDateTime(incident.endedAt)}` : ' to now'}
                      {incident.error ? `, ${incident.error}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {service.error && service.status !== 'healthy' && (
              <div className="mt-3 truncate text-xs text-muted-foreground" title={service.error}>
                {service.error}
              </div>
            )}
            {service.work?.linear?.states.length ? (
              <div className="mt-3 flex flex-wrap gap-1">
                {service.work.linear.states.slice(0, 6).map((state) => (
                  <span
                    key={`${service.id}-linear-${state.state}`}
                    className="inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground"
                  >
                    <span className="max-w-24 truncate">{state.state}</span>
                    <span className="font-medium text-foreground">{state.count}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </details>
  );
}

export function Services() {
  const [services, setServices] = useState<ServiceStatusResult[]>([]);
  const [history, setHistory] = useState<ServiceHistorySnapshot | null>(null);
  const [historyRangeHours, setHistoryRangeHours] = useState<HistoryRangeHours>(24);
  const [loading, setLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadServices = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/services`);
      if (!response.ok) {
        throw new Error('Failed to load services');
      }

      const json = await response.json() as ServicesResponse;
      if (!json.success || !Array.isArray(json.data)) {
        throw new Error('Failed to load services');
      }

      setServices(json.data);
      const inlineHistory = normalizeInlineHistory(json.data, json.history);
      if (inlineHistory) {
        setHistory(inlineHistory);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load services');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryError(null);
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/services/history?hours=${historyRangeHours}`);
      if (response.status === 404) {
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to load service history');
      }

      const json = await response.json() as unknown;
      if (!isHistoryResponse(json)) {
        throw new Error('Failed to load service history');
      }

      setHistory(json.data);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Failed to load service history');
    }
  }, [historyRangeHours]);

  useEffect(() => {
    void loadServices();
    const interval = setInterval(() => void loadServices(), 15000);
    return () => clearInterval(interval);
  }, [loadServices]);

  useEffect(() => {
    void loadHistory();
    const interval = setInterval(() => void loadHistory(), 60000);
    return () => clearInterval(interval);
  }, [loadHistory]);

  const counts = useMemo(() => {
    return services.reduce(
      (acc, service) => {
        acc.total += 1;
        if (service.status === 'healthy') acc.healthy += 1;
        if (service.status === 'timeout') acc.slow += 1;
        if (service.status === 'unhealthy') acc.down += 1;
        if (service.work?.pullRequests?.open !== null && service.work?.pullRequests?.open !== undefined) {
          acc.openPrs += service.work.pullRequests.open;
        }
        if (service.work?.linear?.total !== null && service.work?.linear?.total !== undefined) {
          acc.openTickets += service.work.linear.total;
        }
        return acc;
      },
      { total: 0, healthy: 0, slow: 0, down: 0, openPrs: 0, openTickets: 0 },
    );
  }, [services]);

  const orderedServices = useMemo(() => {
    return [...services].sort((a, b) => {
      const statusDelta = statusWeight[a.status] - statusWeight[b.status];
      if (statusDelta !== 0) return statusDelta;
      return a.name.localeCompare(b.name);
    });
  }, [services]);

  const incidentCount = useMemo(() => {
    return Object.values(history?.services ?? {}).reduce(
      (sum, entry) => sum + entry.incidents.length,
      0,
    );
  }, [history]);

  if (loading) {
    return (
      <div
        data-testid="services-loading"
        className="space-y-3"
      >
        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-destructive">{error}</div>
        <Button variant="outline" size="sm" onClick={() => { void loadServices(); void loadHistory(); }}>
          <RefreshCw className="h-4 w-4" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <SummaryTile label="Up" value={`${counts.healthy}/${counts.total}`} tone={counts.down > 0 ? 'danger' : 'good'} />
          <SummaryTile label="Down" value={counts.down} tone={counts.down > 0 ? 'danger' : 'default'} />
          <SummaryTile label="Slow" value={counts.slow} tone={counts.slow > 0 ? 'warning' : 'default'} />
          <SummaryTile label="Incidents" value={incidentCount} tone={incidentCount > 0 ? 'warning' : 'default'} />
          <SummaryTile label="Open PRs" value={counts.openPrs} />
          <SummaryTile label="Tickets" value={counts.openTickets} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border bg-background p-0.5">
            {historyRanges.map((range) => (
              <button
                key={range.value}
                aria-pressed={historyRangeHours === range.value}
                className={`min-h-8 rounded px-2.5 text-xs font-medium transition-colors ${
                  historyRangeHours === range.value
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
                type="button"
                onClick={() => setHistoryRangeHours(range.value)}
              >
                {range.label}
              </button>
            ))}
          </div>
          <Button
            aria-label="Refresh services"
            title="Refresh services"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => { void loadServices(); void loadHistory(); }}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {historyError && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {historyError}
        </div>
      )}

      {services.length === 0 ? (
        <div className="py-4 text-center text-sm text-muted-foreground">
          No services configured
        </div>
      ) : (
        <div className="space-y-2">
          {orderedServices.map((service) => (
            <ServiceRow
              key={service.id}
              history={history?.services[service.id]}
              service={service}
            />
          ))}
        </div>
      )}
    </div>
  );
}
