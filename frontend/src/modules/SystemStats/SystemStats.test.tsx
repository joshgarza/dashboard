import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';

const mockDevices = [
  { id: '1', name: 'Pi 1', host: '192.168.1.100', port: 3002, type: 'raspberry-pi' },
  { id: '2', name: 'Server', host: '192.168.1.101', port: 3002, type: 'server' },
];

const mockStats = {
  cpu: 45.5,
  memory: { used: 2147483648, total: 4294967296 },
  disk: { used: 107374182400, total: 214748364800 },
  uptime: 86400,
  hostname: 'pi-1',
};

jest.unstable_mockModule('@/config', () => ({
  config: {
    apiBaseUrl: 'http://localhost:3001',
  },
}));

const { SystemStats } = await import('./SystemStats');

describe('SystemStats', () => {
  beforeEach(() => {
    (globalThis.fetch as unknown) = undefined;
  });

  it('shows loading state while fetching devices', () => {
    globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;

    render(<SystemStats />);

    expect(screen.getByTestId('devices-loading')).toBeInTheDocument();
  });

  it('fetches and displays device list', async () => {
    let callCount = 0;
    globalThis.fetch = ((url: string) => {
      callCount++;
      if (url.includes('/api/devices') && !url.includes('/stats')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockDevices }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockStats }),
      } as Response);
    }) as typeof fetch;

    render(<SystemStats />);

    await waitFor(() => {
      expect(screen.getByText('Pi 1')).toBeInTheDocument();
    });

    expect(screen.getByText('Server')).toBeInTheDocument();
  });

  it('displays stats for each device', async () => {
    globalThis.fetch = ((url: string) => {
      if (url.includes('/api/devices') && !url.includes('/stats')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: [mockDevices[0]] }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockStats }),
      } as Response);
    }) as typeof fetch;

    render(<SystemStats />);

    await waitFor(() => {
      expect(screen.getByText(/45.5%/)).toBeInTheDocument();
    });
  });

  it('shows device status indicator', async () => {
    globalThis.fetch = ((url: string) => {
      if (url.includes('/api/devices') && !url.includes('/stats')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: [mockDevices[0]] }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockStats }),
      } as Response);
    }) as typeof fetch;

    render(<SystemStats />);

    await waitFor(() => {
      expect(screen.getByTestId('status-online')).toBeInTheDocument();
    });
  });

  it('handles offline device gracefully', async () => {
    globalThis.fetch = ((url: string) => {
      if (url.includes('/api/devices') && !url.includes('/stats')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: [mockDevices[0]] }),
        } as Response);
      }
      return Promise.resolve({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ success: false, error: { message: 'Device offline' } }),
      } as Response);
    }) as typeof fetch;

    render(<SystemStats />);

    await waitFor(() => {
      expect(screen.getByTestId('status-offline')).toBeInTheDocument();
    });
  });

  it('displays empty state when no devices registered', async () => {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: [] }),
      } as Response)
    ) as typeof fetch;

    render(<SystemStats />);

    await waitFor(() => {
      expect(screen.getByText(/no devices registered/i)).toBeInTheDocument();
    });
  });
});
