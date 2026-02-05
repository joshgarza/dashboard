import { useState, useEffect } from 'react';
import { Cloud, Droplets, Sun, CloudRain, CloudSnow, CloudFog } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { config } from '@/config';

interface WeatherData {
  main: {
    temp: number;
    humidity: number;
  };
  weather: Array<{
    description: string;
    icon: string;
  }>;
  name: string;
}

const getWeatherIcon = (icon: string) => {
  if (icon.includes('01')) return <Sun className="h-8 w-8 text-yellow-500" />;
  if (icon.includes('02') || icon.includes('03') || icon.includes('04'))
    return <Cloud className="h-8 w-8 text-gray-400" />;
  if (icon.includes('09') || icon.includes('10'))
    return <CloudRain className="h-8 w-8 text-blue-400" />;
  if (icon.includes('13')) return <CloudSnow className="h-8 w-8 text-blue-200" />;
  if (icon.includes('50')) return <CloudFog className="h-8 w-8 text-gray-300" />;
  return <Cloud className="h-8 w-8 text-gray-400" />;
};

export function WeatherTime() {
  const [time, setTime] = useState(new Date());
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherError, setWeatherError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const fetchWeather = async () => {
      const apiKey = config.weatherApiKey;
      if (!apiKey) {
        setWeatherError('Weather API key not configured');
        setWeatherLoading(false);
        return;
      }

      try {
        const response = await fetch(
          `https://api.openweathermap.org/data/2.5/weather?q=New York&units=imperial&appid=${apiKey}`
        );

        if (!response.ok) {
          throw new Error('Failed to fetch weather');
        }

        const data = await response.json();
        setWeather(data);
        setWeatherError(null);
      } catch {
        setWeatherError('Unable to load weather');
      } finally {
        setWeatherLoading(false);
      }
    };

    fetchWeather();

    const weatherInterval = setInterval(fetchWeather, 5 * 60 * 1000);

    return () => clearInterval(weatherInterval);
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <div className="space-y-4">
      <div className="text-center">
        <div className="text-4xl font-bold">{formatTime(time)}</div>
        <div className="text-muted-foreground">{formatDate(time)}</div>
      </div>

      <div className="border-t pt-4">
        {weatherLoading ? (
          <div data-testid="weather-loading" className="space-y-2">
            <Skeleton className="h-8 w-24 mx-auto" />
            <Skeleton className="h-4 w-32 mx-auto" />
          </div>
        ) : weatherError ? (
          <div className="text-center text-muted-foreground text-sm">
            {weatherError}
          </div>
        ) : weather ? (
          <div className="flex items-center justify-center gap-4">
            {getWeatherIcon(weather.weather[0]?.icon || '')}
            <div>
              <div className="text-2xl font-semibold">
                {Math.round(weather.main.temp)}°F
              </div>
              <div className="text-sm text-muted-foreground capitalize">
                {weather.weather[0]?.description}
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Droplets className="h-3 w-3" />
                {weather.main.humidity}%
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
