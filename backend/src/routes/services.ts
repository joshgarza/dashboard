import {
  Router,
  Request,
  Response,
  NextFunction,
} from 'express';
import {
  backfillServiceWorkHistory,
  getServiceStatuses,
  parseServiceHistoryRange,
  type ServiceHistoryRange,
  type ServiceStatusResult,
} from '../services/serviceStatus.js';

const router = Router();
const rangeHours: Record<ServiceHistoryRange, number> = {
  '24h': 24,
  '7d': 168,
  '30d': 720,
};

function parseHistoryHours(value: unknown): ServiceHistoryRange {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 24) return '24h';
  if (parsed <= 168) return '7d';
  return '30d';
}

function parseBackfillRange(value: unknown): ServiceHistoryRange | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return '30d';
  return parseServiceHistoryRange(raw);
}

function durationMinutes(startedAt: string, endedAt: string | null): number | null {
  if (!endedAt) return null;
  const startedMs = new Date(startedAt).getTime();
  const endedMs = new Date(endedAt).getTime();
  if (Number.isNaN(startedMs) || Number.isNaN(endedMs)) return null;
  return Math.max(0, Math.round((endedMs - startedMs) / 60000));
}

function historySnapshotFromServices(services: ServiceStatusResult[], range: ServiceHistoryRange) {
  return {
    rangeHours: rangeHours[range],
    generatedAt: new Date().toISOString(),
    services: Object.fromEntries(
      services.map((service) => [
        service.id,
        {
          serviceId: service.id,
          serviceName: service.name,
          uptimePct: service.history?.samples.length
            ? Math.round(
              (service.history.samples.filter((sample) => sample.status === 'healthy').length /
                service.history.samples.length) * 1000,
            ) / 10
            : null,
          lastDownAt: [...(service.history?.samples ?? [])]
            .reverse()
            .find((sample) => sample.status === 'unhealthy' || sample.status === 'timeout')
            ?.checkedAt ?? null,
          samples: (service.history?.samples ?? []).map((sample) => ({
            sampledAt: sample.checkedAt,
            status: sample.status,
            responseTimeMs: sample.responseTimeMs,
            openPrs: sample.openPrs,
            linearTotal: sample.linearTotal,
            ...(sample.error ? { error: sample.error } : {}),
          })),
          workSamples: (service.history?.workSamples ?? []).map((sample) => ({
            sampledAt: sample.checkedAt,
            openPrs: sample.openPrs,
            linearTotal: sample.linearTotal,
          })),
          incidents: (service.history?.incidents ?? []).map((incident) => ({
            serviceId: service.id,
            status: incident.status,
            startedAt: incident.startedAt,
            endedAt: incident.endedAt,
            durationMinutes: durationMinutes(incident.startedAt, incident.endedAt),
            ...(incident.lastError ? { error: incident.lastError } : {}),
          })),
          metricSeries: (service.history?.metricSeries ?? []).map((series) => ({
            label: series.label,
            ...(series.tone ? { tone: series.tone } : {}),
            points: series.points.map((point) => ({
              sampledAt: point.checkedAt,
              value: point.value,
            })),
          })),
        },
      ]),
    ),
  };
}

router.get('/services', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const historyRange = parseServiceHistoryRange(req.query.range);
    if (!historyRange) {
      res.status(400).json({ success: false, error: 'range must be 24h, 7d, or 30d' });
      return;
    }

    const services = await getServiceStatuses({ historyRange });
    res.json({ success: true, data: services });
  } catch (err) {
    next(err);
  }
});

router.get('/services/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const historyRange = parseHistoryHours(req.query.hours);
    const services = await getServiceStatuses({ historyRange });
    res.json({ success: true, data: historySnapshotFromServices(services, historyRange) });
  } catch (err) {
    next(err);
  }
});

router.post('/services/history/backfill', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const historyRange = parseBackfillRange(req.query.range);
    if (!historyRange) {
      res.status(400).json({ success: false, error: 'range must be 24h, 7d, or 30d' });
      return;
    }

    const result = await backfillServiceWorkHistory({ range: historyRange });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

export { router as servicesRouter };
