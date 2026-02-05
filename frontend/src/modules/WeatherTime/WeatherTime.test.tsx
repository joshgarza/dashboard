import { jest } from '@jest/globals';
import { render, screen, waitFor, act } from '@testing-library/react';

jest.unstable_mockModule('@/config', () => ({
  config: {
    weatherApiKey: 'test-api-key',
  },
}));

const { WeatherTime } = await import('./WeatherTime');

const mockWeatherData = {
  main: {
    temp: 72,
    humidity: 45,
  },
  weather: [{ description: 'clear sky', icon: '01d' }],
  name: 'New York',
};

describe('WeatherTime', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-15T14:30:00'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('displays current time', () => {
    render(<WeatherTime />);

    expect(screen.getByText(/2:30/)).toBeInTheDocument();
  });

  it('updates time every second', () => {
    render(<WeatherTime />);

    expect(screen.getByText(/2:30/)).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(60000);
    });

    expect(screen.getByText(/2:31/)).toBeInTheDocument();
  });

  it('displays date', () => {
    render(<WeatherTime />);

    expect(screen.getByText(/January 15/)).toBeInTheDocument();
  });

  it('shows loading state while fetching weather', async () => {
    globalThis.fetch = (() =>
      new Promise(() => {})
    ) as typeof fetch;

    render(<WeatherTime />);

    expect(screen.getByTestId('weather-loading')).toBeInTheDocument();
  });

  it('displays weather data on successful fetch', async () => {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockWeatherData),
      } as Response)
    ) as typeof fetch;

    jest.useRealTimers();

    render(<WeatherTime />);

    await waitFor(() => {
      expect(screen.getByText(/72°/)).toBeInTheDocument();
    });

    expect(screen.getByText(/clear sky/i)).toBeInTheDocument();
  });

  it('handles weather API error gracefully', async () => {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: false,
        status: 500,
      } as Response)
    ) as typeof fetch;

    jest.useRealTimers();

    render(<WeatherTime />);

    await waitFor(() => {
      expect(screen.getByText(/unable to load weather/i)).toBeInTheDocument();
    });
  });
});
