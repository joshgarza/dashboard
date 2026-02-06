import { jest } from '@jest/globals';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { act } from 'react';

jest.unstable_mockModule('@/config', () => ({
  config: {
    weatherApiKey: 'test-key',
    apiBaseUrl: 'http://localhost:3001',
  },
}));

const { default: App } = await import('./App');

const mockMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: matches && query === '(prefers-color-scheme: dark)',
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    }),
  });
};

describe('App', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    mockMatchMedia(false);
    // Mock fetch to return appropriate data based on URL
    globalThis.fetch = ((url: string) => {
      // Weather API mock
      if (url.includes('openweathermap')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            main: { temp: 72, humidity: 45 },
            weather: [{ description: 'clear sky', icon: '01d' }],
            name: 'New York',
          }),
        } as Response);
      }
      // CRM pipeline/contacts mock
      if (url.includes('/crm/pipeline') || url.includes('/crm/contacts')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { total: 0, stages: {} } }),
        } as Response);
      }
      // Obsidian weekly-todos mock
      if (url.includes('/obsidian/weekly-todos')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { noteTitle: '2026 Week 05', completed: 0, total: 0, weekOf: 'February 02, 2026' },
          }),
        } as Response);
      }
      // Backend API mock (devices endpoint)
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: [] }),
      } as Response);
    }) as typeof fetch;
  });

  afterEach(async () => {
    // Let pending async operations complete
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    cleanup();
  });

  it('renders the dashboard header', async () => {
    render(<App />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    // Wait for SystemStats to finish loading (shows "No devices registered" when empty)
    await waitFor(() => {
      expect(screen.getByText(/No devices registered/i)).toBeInTheDocument();
    });
  });

  it('renders the theme toggle button', async () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /switch to dark mode/i })).toBeInTheDocument();
    // Wait for SystemStats to finish loading
    await waitFor(() => {
      expect(screen.getByText(/No devices registered/i)).toBeInTheDocument();
    });
  });
});
