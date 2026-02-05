import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';

const mockContactsData = {
  total: 63,
  stages: {
    'Reconnect': 28,
    'Archive': 17,
    'Follow-Up': 5,
    'Contacted': 5,
    'Engaged': 4,
    'Post-Meeting': 2,
    'Meeting Scheduled': 2,
  },
};

jest.unstable_mockModule('@/config', () => ({
  config: {
    apiBaseUrl: 'http://localhost:3001',
  },
}));

const { Contacts } = await import('./Contacts');

describe('Contacts', () => {
  beforeEach(() => {
    (globalThis.fetch as unknown) = undefined;
  });

  it('shows loading state while fetching data', () => {
    globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;

    render(<Contacts />);

    expect(screen.getAllByRole('generic').some(el =>
      el.className.includes('animate-pulse')
    )).toBe(true);
  });

  it('displays total contact count', async () => {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockContactsData }),
      } as Response)
    ) as typeof fetch;

    render(<Contacts />);

    await waitFor(() => {
      expect(screen.getByText('63 contacts')).toBeInTheDocument();
    });
  });

  it('displays all stages with counts', async () => {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { total: 45, stages: { 'Reconnect': 28, 'Archive': 17 } },
        }),
      } as Response)
    ) as typeof fetch;

    render(<Contacts />);

    await waitFor(() => {
      expect(screen.getByText('Reconnect')).toBeInTheDocument();
    });

    expect(screen.getByText('28')).toBeInTheDocument();
    expect(screen.getByText('Archive')).toBeInTheDocument();
    expect(screen.getByText('17')).toBeInTheDocument();
  });

  it('shows error message on fetch failure', async () => {
    globalThis.fetch = (() =>
      Promise.reject(new Error('Network error'))
    ) as typeof fetch;

    render(<Contacts />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load contacts')).toBeInTheDocument();
    });
  });

  it('shows error message when API returns error', async () => {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: false, error: 'CRM unavailable' }),
      } as Response)
    ) as typeof fetch;

    render(<Contacts />);

    await waitFor(() => {
      expect(screen.getByText('CRM unavailable')).toBeInTheDocument();
    });
  });

  it('handles empty contact data', async () => {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { total: 0, stages: {} } }),
      } as Response)
    ) as typeof fetch;

    render(<Contacts />);

    await waitFor(() => {
      expect(screen.getByText('0 contacts')).toBeInTheDocument();
    });
  });
});
