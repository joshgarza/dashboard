import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';

const mockTodoData = {
  noteTitle: '2026 Week 05',
  completed: 5,
  total: 12,
  weekOf: 'February 02, 2026',
};

jest.unstable_mockModule('@/config', () => ({
  config: {
    apiBaseUrl: 'http://localhost:3001',
  },
}));

const { WeeklyTodos } = await import('./WeeklyTodos');

describe('WeeklyTodos', () => {
  beforeEach(() => {
    (globalThis.fetch as unknown) = undefined;
  });

  it('shows loading state while fetching data', () => {
    globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;

    render(<WeeklyTodos />);

    expect(screen.getAllByRole('generic').some(el =>
      el.className.includes('animate-pulse')
    )).toBe(true);
  });

  it('displays task completion count', async () => {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockTodoData }),
      } as Response)
    ) as typeof fetch;

    render(<WeeklyTodos />);

    await waitFor(() => {
      expect(screen.getByText('5/12 tasks complete')).toBeInTheDocument();
    });
  });

  it('displays week of date', async () => {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockTodoData }),
      } as Response)
    ) as typeof fetch;

    render(<WeeklyTodos />);

    await waitFor(() => {
      expect(screen.getByText(/Week of February 02, 2026/)).toBeInTheDocument();
    });
  });

  it('shows error message on fetch failure', async () => {
    globalThis.fetch = (() =>
      Promise.reject(new Error('Network error'))
    ) as typeof fetch;

    render(<WeeklyTodos />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load weekly todos')).toBeInTheDocument();
    });
  });

  it('shows error message when API returns error object', async () => {
    // Backend returns error as {message, code} object
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: false,
          error: { message: 'Weekly note not found: 2026 Week 06.md', code: 'INTERNAL_ERROR' },
        }),
      } as Response)
    ) as typeof fetch;

    render(<WeeklyTodos />);

    await waitFor(() => {
      expect(screen.getByText('Weekly note not found: 2026 Week 06.md')).toBeInTheDocument();
    });
  });

  it('shows error message when API returns error string', async () => {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: false, error: 'Note not found' }),
      } as Response)
    ) as typeof fetch;

    render(<WeeklyTodos />);

    await waitFor(() => {
      expect(screen.getByText('Note not found')).toBeInTheDocument();
    });
  });

  it('handles zero todos gracefully', async () => {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { noteTitle: '2026 Week 05', completed: 0, total: 0, weekOf: 'February 02, 2026' },
        }),
      } as Response)
    ) as typeof fetch;

    render(<WeeklyTodos />);

    await waitFor(() => {
      expect(screen.getByText('0/0 tasks complete')).toBeInTheDocument();
    });
  });

  it('handles all tasks completed', async () => {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { noteTitle: '2026 Week 05', completed: 10, total: 10, weekOf: 'February 02, 2026' },
        }),
      } as Response)
    ) as typeof fetch;

    render(<WeeklyTodos />);

    await waitFor(() => {
      expect(screen.getByText('10/10 tasks complete')).toBeInTheDocument();
    });
  });

  it('fetches from correct API endpoint', async () => {
    const mockFetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockTodoData }),
      } as Response)
    ) as jest.MockedFunction<typeof fetch>;

    globalThis.fetch = mockFetch;

    render(<WeeklyTodos />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3001/api/obsidian/weekly-todos');
    });
  });
});
