import { jest } from '@jest/globals';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

jest.unstable_mockModule('@/config', () => ({
  config: {
    apiBaseUrl: 'http://localhost:3001',
  },
}));

jest.unstable_mockModule('react-router-dom', () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
}));

const { TodayTodos } = await import('./TodayTodos');

const mockTodayData = {
  plan: {
    focus: 'Admin catch-up day',
    tasks: [
      { text: 'Print POD permits', source: '- [ ] Print POD permits', completed: false },
      { text: 'Follow up with Nathan', source: '- [ ] Follow up with Nathan', completed: false },
      { text: 'Message Christina', source: '- [x] Message Christina', completed: true },
    ],
  },
  goals: ['Clear admin backlog', 'Claude tooling setup'],
};

describe('TodayTodos', () => {
  beforeEach(() => {
    (globalThis.fetch as unknown) = undefined;
  });

  it('shows loading state while fetching data', () => {
    globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;

    render(<TodayTodos />);

    expect(screen.getAllByRole('generic').some(el =>
      el.className.includes('animate-pulse')
    )).toBe(true);
  });

  it('renders interview button when status.needed is true', async () => {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { needed: true, week: '2026-W08' },
        }),
      } as Response)
    ) as typeof fetch;

    render(<TodayTodos />);

    await waitFor(() => {
      expect(screen.getByText('Start Weekly Review')).toBeInTheDocument();
    });
  });

  it('renders task list when today plan exists', async () => {
    let callCount = 0;
    globalThis.fetch = (() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { needed: false, week: '2026-W08' },
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: mockTodayData,
        }),
      } as Response);
    }) as typeof fetch;

    render(<TodayTodos />);

    await waitFor(() => {
      expect(screen.getByText('Print POD permits')).toBeInTheDocument();
      expect(screen.getByText('Follow up with Nathan')).toBeInTheDocument();
      expect(screen.getByText('Message Christina')).toBeInTheDocument();
    });
  });

  it('checkbox toggle calls API and updates optimistically', async () => {
    let callCount = 0;
    const calls: string[] = [];
    globalThis.fetch = ((url: string, opts?: RequestInit) => {
      calls.push(`${opts?.method || 'GET'} ${url}`);
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { needed: false, week: '2026-W08' },
          }),
        } as Response);
      }
      if (callCount === 2) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: mockTodayData,
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { text: 'Print POD permits', source: '- [x] Print POD permits', completed: true },
        }),
      } as Response);
    }) as typeof fetch;

    render(<TodayTodos />);

    await waitFor(() => {
      expect(screen.getByText('Print POD permits')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Print POD permits'));

    await waitFor(() => {
      expect(calls).toContainEqual('POST http://localhost:3001/api/weekly-review/today/0/toggle');
    });
  });

  it('renders "all done" state when all tasks completed', async () => {
    const allDoneData = {
      plan: {
        focus: 'Admin catch-up day',
        tasks: [
          { text: 'Print POD permits', source: '- [x] Print POD permits', completed: true },
          { text: 'Follow up with Nathan', source: '- [x] Follow up with Nathan', completed: true },
        ],
      },
      goals: ['Clear admin backlog'],
    };

    let callCount = 0;
    globalThis.fetch = (() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { needed: false, week: '2026-W08' },
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: allDoneData,
        }),
      } as Response);
    }) as typeof fetch;

    render(<TodayTodos />);

    await waitFor(() => {
      expect(screen.getByText('All done for today!')).toBeInTheDocument();
    });
  });

  it('handles error state', async () => {
    globalThis.fetch = (() =>
      Promise.reject(new Error('Network error'))
    ) as typeof fetch;

    render(<TodayTodos />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load weekly review status')).toBeInTheDocument();
    });
  });

  it('shows focus and goals when plan exists', async () => {
    let callCount = 0;
    globalThis.fetch = (() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { needed: false, week: '2026-W08' },
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: mockTodayData,
        }),
      } as Response);
    }) as typeof fetch;

    render(<TodayTodos />);

    await waitFor(() => {
      expect(screen.getByText('Focus: Admin catch-up day')).toBeInTheDocument();
      expect(screen.getByText(/Clear admin backlog/)).toBeInTheDocument();
    });
  });
});
