import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock, RefreshCw, Server, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { config } from '@/config';

type ServiceStatus = 'healthy' | 'unhealthy' | 'timeout' | 'unknown';

interface ServiceMetric {
  label: string;
  value: number | string;
  tone?: 'default' | 'good' | 'warning' | 'danger';
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
}

interface ServicesResponse {
  success: boolean;
  data: ServiceStatusResult[];
}

const statusMeta: Record<ServiceStatus, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  healthy: {
    label: 'Up',
    className: 'text-emerald-600 dark:text-emerald-400',
    icon: CheckCircle2,
  },
  unhealthy: {
    label: 'Down',
    className: 'text-red-600 dark:text-red-400',
    icon: XCircle,
  },
  timeout: {
    label: 'Slow',
    className: 'text-amber-600 dark:text-amber-400',
    icon: AlertTriangle,
  },
  unknown: {
    label: 'Unknown',
    className: 'text-muted-foreground',
    icon: AlertTriangle,
  },
};

function formatCheckedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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

function ServiceRow({ service }: { service: ServiceStatusResult }) {
  const meta = statusMeta[service.status] ?? statusMeta.unknown;
  const StatusIcon = meta.icon;
  const activity = formatActivity(service.lastActivityAt);

  return (
    <div className="rounded-md border px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{service.name}</span>
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {service.baseUrl}
          </div>
        </div>
        <div className={`flex shrink-0 items-center gap-1 text-xs font-medium ${meta.className}`}>
          <StatusIcon className="h-3.5 w-3.5" />
          {meta.label}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatCheckedAt(service.checkedAt)}
        </span>
        {typeof service.responseTimeMs === 'number' && (
          <span>{service.responseTimeMs}ms</span>
        )}
        {activity && (
          <span className="inline-flex items-center gap-1">
            <Activity className="h-3 w-3" />
            {activity}
          </span>
        )}
      </div>

      {service.metrics.length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {service.metrics.slice(0, 4).map((metric) => (
            <div key={`${service.id}-${metric.label}`} className="min-w-0">
              <div className={`truncate text-sm font-semibold ${metricClassName(metric.tone)}`}>
                {metric.value}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">{metric.label}</div>
            </div>
          ))}
        </div>
      )}

      {service.error && service.status !== 'healthy' && (
        <div className="mt-2 truncate text-xs text-muted-foreground" title={service.error}>
          {service.error}
        </div>
      )}
    </div>
  );
}

export function Services() {
  const [services, setServices] = useState<ServiceStatusResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadServices = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/services`);
      if (!response.ok) {
        throw new Error('Failed to load services');
      }

      const json = await response.json() as ServicesResponse;
      if (!json.success) {
        throw new Error('Failed to load services');
      }

      setServices(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load services');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadServices();
    const interval = setInterval(() => void loadServices(), 15000);
    return () => clearInterval(interval);
  }, [loadServices]);

  const counts = useMemo(() => {
    return services.reduce(
      (acc, service) => {
        acc.total += 1;
        if (service.status === 'healthy') acc.healthy += 1;
        if (service.status === 'unhealthy' || service.status === 'timeout') acc.unhealthy += 1;
        return acc;
      },
      { total: 0, healthy: 0, unhealthy: 0 },
    );
  }, [services]);

  if (loading) {
    return (
      <div data-testid="services-loading" className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-destructive">{error}</div>
        <Button variant="outline" size="sm" onClick={() => void loadServices()}>
          <RefreshCw className="h-4 w-4" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{counts.healthy}</span>
          {' / '}
          {counts.total}
          {' up'}
        </div>
        <Button
          aria-label="Refresh services"
          title="Refresh services"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => void loadServices()}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {services.length === 0 ? (
        <div className="py-4 text-center text-sm text-muted-foreground">
          No services configured
        </div>
      ) : (
        <div className="space-y-2">
          {services.map((service) => (
            <ServiceRow key={service.id} service={service} />
          ))}
        </div>
      )}
    </div>
  );
}
