import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { config } from '@/config';

interface CalendarEntry {
  time: string;
  title: string;
  isAllDay: boolean;
}

export function TodaySchedule() {
  const [events, setEvents] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${config.apiBaseUrl}/api/calendar/today`)
      .then(res => res.json())
      .then(json => {
        if (json.success) {
          setEvents(json.data);
        } else {
          const errorMsg = typeof json.error === 'object' ? json.error?.message : json.error;
          setError(errorMsg || 'Failed to load schedule');
        }
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load schedule');
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }

  if (error) {
    return <div className="text-destructive text-sm">{error}</div>;
  }

  if (events.length === 0) {
    return (
      <div className="text-muted-foreground text-sm text-center py-4">
        No events scheduled for today
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          {events.length} event{events.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="space-y-2">
        {events.map((event, i) => (
          <div key={i} className="flex items-start gap-3 text-sm">
            <span className="w-20 shrink-0 text-muted-foreground font-mono text-xs pt-0.5">
              {event.time}
            </span>
            <span className="truncate">{event.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
