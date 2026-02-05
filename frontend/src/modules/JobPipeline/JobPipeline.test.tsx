import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';

const mockPipelineData = {
  total: 10,
  stages: {
    'To Apply': 5,
    'Applied': 3,
    'Interview': 2,
  },
};

jest.unstable_mockModule('@/config', () => ({
  config: {
    apiBaseUrl: 'http://localhost:3001',
  },
}));

const { JobPipeline } = await import('./JobPipeline');

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

  it('displays total opportunities count', async () => {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockPipelineData }),
      } as Response)
    ) as typeof fetch;

    render(<JobPipeline />);

    await waitFor(() => {
      expect(screen.getByText('10 opportunities')).toBeInTheDocument();
    });
  });

  it('displays all pipeline stages', async () => {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockPipelineData }),
      } as Response)
    ) as typeof fetch;

    render(<JobPipeline />);

    await waitFor(() => {
      expect(screen.getByText('To Apply')).toBeInTheDocument();
    });

    expect(screen.getByText('Applied')).toBeInTheDocument();
    expect(screen.getByText('Interview')).toBeInTheDocument();
  });

  it('displays stage counts', async () => {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockPipelineData }),
      } as Response)
    ) as typeof fetch;

    render(<JobPipeline />);

    await waitFor(() => {
      expect(screen.getByText('5')).toBeInTheDocument();
    });

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
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

  it('handles empty pipeline data', async () => {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { total: 0, stages: {} } }),
      } as Response)
    ) as typeof fetch;

    render(<JobPipeline />);

    await waitFor(() => {
      expect(screen.getByText('0 opportunities')).toBeInTheDocument();
    });
  });
});
