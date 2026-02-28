import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';

jest.unstable_mockModule('@/config', () => ({
  config: {
    apiBaseUrl: 'http://localhost:3001',
  },
}));

const { Contacts } = await import('./Contacts');

function mockFetchResponse(data: unknown) {
  globalThis.fetch = (() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ success: true, data }),
    } as Response)
  ) as typeof fetch;
}

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

  it('displays focus items for meetings and imminent follow-ups', async () => {
    mockFetchResponse({
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
      imminentFollowUps: 3,
    });

    render(<Contacts />);

    await waitFor(() => {
      expect(screen.getByText('Prep for meetings')).toBeInTheDocument();
    });
    expect(screen.getByText('2 meetings scheduled')).toBeInTheDocument();
    expect(screen.getByText('Follow up with contacts')).toBeInTheDocument();
    expect(screen.getByText('3 contacts need follow-up soon')).toBeInTheDocument();
  });

  it('shows singular text for one imminent follow-up', async () => {
    mockFetchResponse({
      total: 10,
      stages: { 'Follow-Up': 5 },
      imminentFollowUps: 1,
    });

    render(<Contacts />);

    await waitFor(() => {
      expect(screen.getByText('Follow up with a contact')).toBeInTheDocument();
    });
    expect(screen.getByText('1 contact need follow-up soon')).toBeInTheDocument();
  });

  it('hides follow-up item when no imminent follow-ups', async () => {
    mockFetchResponse({
      total: 10,
      stages: { 'Follow-Up': 5, 'Post-Meeting': 3 },
      imminentFollowUps: 0,
    });

    render(<Contacts />);

    await waitFor(() => {
      expect(screen.getByText('Contacts')).toBeInTheDocument();
    });
    expect(screen.queryByText('Follow up with contacts')).not.toBeInTheDocument();
    expect(screen.queryByText('Follow up with a contact')).not.toBeInTheDocument();
  });

  it('shows fallback when no actionable items', async () => {
    mockFetchResponse({
      total: 0,
      stages: {},
      imminentFollowUps: 0,
    });

    render(<Contacts />);

    await waitFor(() => {
      expect(screen.getByText('Expand your network')).toBeInTheDocument();
    });
    expect(screen.getByText('Add new contacts to get started')).toBeInTheDocument();
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
});
