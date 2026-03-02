import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';

jest.unstable_mockModule('@/config', () => ({
  config: {
    apiBaseUrl: 'http://localhost:3001',
  },
}));

const { JobPipeline } = await import('./JobPipeline');

function mockFetchResponse(data: unknown) {
  globalThis.fetch = (() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ success: true, data }),
    } as Response)
  ) as typeof fetch;
}

describe('JobPipeline', () => {
  beforeEach(() => {
    (globalThis.fetch as unknown) = undefined;
  });

  it('shows loading state while fetching data', () => {
    globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;

    render(<JobPipeline />);

    expect(screen.getAllByRole('generic').some(el =>
      el.className.includes('animate-pulse')
    )).toBe(true);
  });

  it('displays focus items for interviews and applications', async () => {
    mockFetchResponse({
      total: 10,
      stages: {
        'To Apply': 5,
        'Applied': 3,
        'Interview': 2,
      },
    });

    render(<JobPipeline />);

    await waitFor(() => {
      expect(screen.getByText('Focus on interview prep')).toBeInTheDocument();
    });
    expect(screen.getByText('2 interviews in progress')).toBeInTheDocument();
    expect(screen.getByText('Submit your applications')).toBeInTheDocument();
    expect(screen.getByText('5 jobs queued to apply')).toBeInTheDocument();
  });

  it('shows singular text for one interview', async () => {
    mockFetchResponse({
      total: 3,
      stages: { 'Interview': 1 },
    });

    render(<JobPipeline />);

    await waitFor(() => {
      expect(screen.getByText('Prep for your interview')).toBeInTheDocument();
    });
    expect(screen.getByText('1 interview coming up')).toBeInTheDocument();
  });

  it('shows error message on fetch failure', async () => {
    globalThis.fetch = (() =>
      Promise.reject(new Error('Network error'))
    ) as typeof fetch;

    render(<JobPipeline />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load pipeline data')).toBeInTheDocument();
    });
  });

  it('shows error message when API returns error', async () => {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: false, error: 'CRM unavailable' }),
      } as Response)
    ) as typeof fetch;

    render(<JobPipeline />);

    await waitFor(() => {
      expect(screen.getByText('CRM unavailable')).toBeInTheDocument();
    });
  });

  it('shows fallback when no actionable items', async () => {
    mockFetchResponse({
      total: 0,
      stages: {},
    });

    render(<JobPipeline />);

    await waitFor(() => {
      expect(screen.getByText('Find more jobs to apply to')).toBeInTheDocument();
    });
    expect(screen.getByText('Start adding to your pipeline')).toBeInTheDocument();
  });
});
