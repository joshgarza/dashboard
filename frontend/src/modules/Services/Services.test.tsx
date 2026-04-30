import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';

jest.unstable_mockModule('@/config', () => ({
  config: {
    apiBaseUrl: 'http://localhost:3001',
  },
}));

const { Services } = await import('./Services');

describe('Services', () => {
  beforeEach(() => {
    (globalThis.fetch as unknown) = undefined;
  });

  it('renders service status rows', async () => {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
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
            },
          ],
        }),
      } as Response)
    ) as typeof fetch;

    render(<Services />);

    await waitFor(() => {
      expect(screen.getByText('hopper')).toBeInTheDocument();
      expect(screen.getByText('Up')).toBeInTheDocument();
      expect(screen.getByText('232')).toBeInTheDocument();
      expect(screen.getByText('Thoughts')).toBeInTheDocument();
    });
  });

  it('renders an error state', async () => {
    globalThis.fetch = (() => Promise.reject(new Error('Network error'))) as typeof fetch;

    render(<Services />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });
});
