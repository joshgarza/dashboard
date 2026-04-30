import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.unstable_mockModule('@/config', () => ({
  config: {
    apiBaseUrl: 'http://localhost:3001',
  },
}));

const { Services } = await import('./Services');

const currentServicesResponse = {
  success: true,
  data: [
    {
      id: 'hopper',
      name: 'hopper',
      baseUrl: 'http://localhost:3000',
      healthEndpoint: '/api/thoughts?limit=0',
      status: 'healthy',
      responseTimeMs: 24,
      checkedAt: '2026-04-29T19:00:00.000Z',
      lastActivityAt: '2026-04-29T18:30:00.000Z',
      metrics: [
        { label: 'Thoughts', value: 232 },
        { label: 'Review', value: 6, tone: 'warning' },
      ],
      work: {
        pullRequests: {
          repo: 'josh/hopper',
          open: 3,
        },
        linear: {
          project: 'hopper',
          total: 9,
          states: [
            { state: 'In Progress', count: 2 },
            { state: 'Todo', count: 7 },
          ],
        },
      },
    },
    {
      id: 'codex',
      name: 'codex',
      baseUrl: 'http://localhost:3002',
      healthEndpoint: '/health',
      status: 'healthy',
      responseTimeMs: 18,
      checkedAt: '2026-04-29T19:00:00.000Z',
      lastActivityAt: null,
      metrics: [],
      work: {
        pullRequests: {
          repo: 'josh/codex',
          open: null,
          error: 'GitHub not configured',
        },
        linear: {
          project: 'codex',
          total: null,
          states: [],
          error: 'Linear not configured',
        },
      },
    },
  ],
};

const historyResponse = {
  success: true,
  data: {
    rangeHours: 24,
    generatedAt: '2026-04-29T19:00:00.000Z',
    services: {
      hopper: {
        serviceId: 'hopper',
        serviceName: 'hopper',
        uptimePct: 75,
        lastDownAt: '2026-04-29T18:00:00.000Z',
        samples: [
          {
            sampledAt: '2026-04-29T16:00:00.000Z',
            status: 'healthy',
            responseTimeMs: 20,
            openPrs: 1,
            linearTotal: 7,
          },
          {
            sampledAt: '2026-04-29T17:00:00.000Z',
            status: 'healthy',
            responseTimeMs: 24,
            openPrs: 2,
            linearTotal: 8,
          },
          {
            sampledAt: '2026-04-29T18:00:00.000Z',
            status: 'timeout',
            responseTimeMs: 90,
            openPrs: 3,
            linearTotal: 9,
            error: 'Request timed out',
          },
          {
            sampledAt: '2026-04-29T19:00:00.000Z',
            status: 'healthy',
            responseTimeMs: 24,
            openPrs: 3,
            linearTotal: 9,
          },
        ],
        incidents: [
          {
            serviceId: 'hopper',
            status: 'timeout',
            startedAt: '2026-04-29T18:00:00.000Z',
            endedAt: '2026-04-29T19:00:00.000Z',
            durationMinutes: 60,
            error: 'Request timed out',
          },
        ],
        metricSeries: [
          {
            label: 'Thoughts',
            points: [
              { sampledAt: '2026-04-29T16:00:00.000Z', value: 220 },
              { sampledAt: '2026-04-29T19:00:00.000Z', value: 232 },
            ],
          },
          {
            label: 'Review',
            tone: 'warning',
            points: [
              { sampledAt: '2026-04-29T16:00:00.000Z', value: 4 },
              { sampledAt: '2026-04-29T19:00:00.000Z', value: 6 },
            ],
          },
        ],
      },
      codex: {
        serviceId: 'codex',
        serviceName: 'codex',
        uptimePct: 100,
        lastDownAt: null,
        samples: [
          {
            sampledAt: '2026-04-29T18:00:00.000Z',
            status: 'healthy',
            responseTimeMs: 16,
            openPrs: null,
            linearTotal: null,
          },
          {
            sampledAt: '2026-04-29T19:00:00.000Z',
            status: 'healthy',
            responseTimeMs: 18,
            openPrs: null,
            linearTotal: null,
          },
        ],
        incidents: [],
        metricSeries: [],
      },
    },
  },
};

const inlineHistoryServicesResponse = {
  ...currentServicesResponse,
  data: [
    {
      ...currentServicesResponse.data[0],
      responseTimeMs: 40,
      history: {
        uptimePct: 75,
        samples: [
          { status: 'healthy', checkedAt: '2026-04-29T16:00:00.000Z', responseTimeMs: 20 },
          { status: 'healthy', checkedAt: '2026-04-29T17:00:00.000Z', responseTimeMs: 24 },
          { status: 'timeout', checkedAt: '2026-04-29T18:00:00.000Z', responseTimeMs: 90, error: 'Request timed out' },
          { status: 'healthy', checkedAt: '2026-04-29T19:00:00.000Z', responseTimeMs: 40 },
        ],
        incidents: [
          {
            status: 'timeout',
            startedAt: '2026-04-29T18:00:00.000Z',
            endedAt: '2026-04-29T18:15:00.000Z',
            durationMinutes: 15,
            error: 'Request timed out',
          },
        ],
      },
    },
    currentServicesResponse.data[1],
  ],
  history: {
    rangeHours: 24,
    generatedAt: '2026-04-29T19:00:00.000Z',
    services: {
      codex: historyResponse.data.services.codex,
    },
  },
};

const historyWithWorkSamplesResponse = {
  ...historyResponse,
  data: {
    ...historyResponse.data,
    services: {
      ...historyResponse.data.services,
      hopper: {
        ...historyResponse.data.services.hopper,
        workSamples: [
          {
            sampledAt: '2026-04-29T16:30:00.000Z',
            openPrs: 10,
            linearTotal: 20,
          },
          {
            sampledAt: '2026-04-29T18:30:00.000Z',
            openPrs: 12,
            linearTotal: 24,
          },
        ],
      },
    },
  },
};

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    json: () => Promise.resolve(payload),
  } as Response;
}

describe('Services', () => {
  beforeEach(() => {
    (globalThis.fetch as unknown) = undefined;
  });

  it('renders service battlestation rows with history', async () => {
    globalThis.fetch = ((url) => {
      const href = String(url);
      if (href.includes('/api/services/history')) {
        return Promise.resolve(jsonResponse(historyResponse));
      }

      return Promise.resolve(jsonResponse(currentServicesResponse));
    }) as typeof fetch;

    render(<Services />);

    await waitFor(() => {
      expect(screen.getByText('hopper')).toBeInTheDocument();
      expect(screen.getByText('2/2')).toBeInTheDocument();
      expect(screen.getByText('Open PRs')).toBeInTheDocument();
      expect(screen.getByText('Tickets')).toBeInTheDocument();
      expect(screen.getByLabelText('hopper uptime 75% over this range.')).toBeInTheDocument();
      expect(screen.getByLabelText('codex uptime 100% over this range.')).toBeInTheDocument();
      expect(screen.getAllByText('Up').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByLabelText('Service endpoint for hopper: http://localhost:3000/api/thoughts?limit=0')).toBeInTheDocument();
      expect(screen.getByLabelText('hopper is up; latest check returned successfully.')).toBeInTheDocument();
      expect(screen.getAllByLabelText(/Last checked at .+ The service is probed every 15 seconds\./)).toHaveLength(2);
      expect(screen.getByLabelText(/Last recorded local data activity was .+\./)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('hopper'));

    await waitFor(() => {
      expect(screen.getByText('Open PRs / josh/hopper')).toBeInTheDocument();
      expect(screen.getByText('Linear / hopper')).toBeInTheDocument();
      expect(screen.getByText('Thoughts')).toBeInTheDocument();
      expect(screen.getByText('Review')).toBeInTheDocument();
      expect(screen.getByText('In Progress')).toBeInTheDocument();
      expect(screen.getByText('Todo')).toBeInTheDocument();
      expect(screen.getByText(/Request timed out/)).toBeInTheDocument();
    });
  });

  it('uses workSamples for work trends while health trends use samples', async () => {
    globalThis.fetch = ((url) => {
      const href = String(url);
      if (href.includes('/api/services/history')) {
        return Promise.resolve(jsonResponse(historyWithWorkSamplesResponse));
      }

      return Promise.resolve(jsonResponse(currentServicesResponse));
    }) as typeof fetch;

    render(<Services />);

    await waitFor(() => {
      expect(screen.getByText('hopper')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('hopper'));

    await waitFor(() => {
      expect(screen.getByLabelText('Latency trend from 20 to 90')).toBeInTheDocument();
      expect(screen.getByLabelText('Open PRs / josh/hopper trend from 10 to 12')).toBeInTheDocument();
      expect(screen.getByLabelText('Linear / hopper trend from 20 to 24')).toBeInTheDocument();
    });
  });

  it('renders history included in the services response', async () => {
    globalThis.fetch = ((url) => {
      const href = String(url);
      if (href.includes('/api/services/history')) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ success: false }),
        } as Response);
      }

      return Promise.resolve(jsonResponse(inlineHistoryServicesResponse));
    }) as typeof fetch;

    render(<Services />);

    await waitFor(() => {
      expect(screen.getByText('2/2')).toBeInTheDocument();
      expect(screen.getByText('75%')).toBeInTheDocument();
      expect(screen.getByText('100%')).toBeInTheDocument();
      expect(screen.getByLabelText('hopper uptime 75% over this range.')).toBeInTheDocument();
      expect(screen.getByLabelText('codex uptime 100% over this range.')).toBeInTheDocument();
      expect(screen.queryByText('Failed to load service history')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('hopper'));

    await waitFor(() => {
      expect(screen.getByLabelText('Latency trend from 20 to 90')).toBeInTheDocument();
      expect(screen.getByText('15m')).toBeInTheDocument();
      expect(screen.getByText(/Request timed out/)).toBeInTheDocument();
    });
  });

  it('renders live services when history is absent', async () => {
    globalThis.fetch = ((url) => {
      const href = String(url);
      if (href.includes('/api/services/history')) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ success: false }),
        } as Response);
      }

      return Promise.resolve(jsonResponse(currentServicesResponse));
    }) as typeof fetch;

    render(<Services />);

    await waitFor(() => {
      expect(screen.getByText('hopper')).toBeInTheDocument();
      expect(screen.getByLabelText('hopper has no recorded history yet.')).toBeInTheDocument();
      expect(screen.queryByText('Failed to load service history')).not.toBeInTheDocument();
    });
  });

  it('renders an error state', async () => {
    globalThis.fetch = ((url) => {
      const href = String(url);
      if (href.includes('/api/services/history')) {
        return Promise.resolve(jsonResponse(historyResponse));
      }

      return Promise.reject(new Error('Network error'));
    }) as typeof fetch;

    render(<Services />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });
});
