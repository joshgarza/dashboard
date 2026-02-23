import { jest } from '@jest/globals';
// @ts-expect-error - polyfill TextEncoder for jsdom + react-router
globalThis.TextEncoder ??= class { encode(s: string) { return new Uint8Array([...s].map(c => c.charCodeAt(0))); } };
// @ts-expect-error - polyfill TextDecoder for jsdom + react-router
globalThis.TextDecoder ??= class { decode(a: Uint8Array) { return String.fromCharCode(...a); } };

import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { act } from 'react';

jest.unstable_mockModule('@/config', () => ({
  config: {
    weatherApiKey: 'test-key',
    apiBaseUrl: 'http://localhost:3001',
  },
}));

const { default: App } = await import('./App');
const { MemoryRouter } = await import('react-router-dom');

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
      // Weekly review status mock
      if (url.includes('/weekly-review/status')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { needed: true, week: '2026-W08' },
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
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    // Wait for SystemStats to finish loading (shows "No devices registered" when empty)
    await waitFor(() => {
      expect(screen.getByText(/No devices registered/i)).toBeInTheDocument();
    });
  });

  it('renders the theme toggle button', async () => {
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(screen.getByRole('button', { name: /switch to dark mode/i })).toBeInTheDocument();
    // Wait for SystemStats to finish loading
    await waitFor(() => {
      expect(screen.getByText(/No devices registered/i)).toBeInTheDocument();
    });
  });
});
