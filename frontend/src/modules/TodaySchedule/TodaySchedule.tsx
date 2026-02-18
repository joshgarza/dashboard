import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { config } from '@/config';

interface CalendarEntry {
  time: string;
  title: string;
  isAllDay: boolean;
  startHour?: number;
}

interface Section {
  label: string;
  events: CalendarEntry[];
}

function groupBySection(events: CalendarEntry[]): Section[] {
  const allDay: CalendarEntry[] = [];
  const morning: CalendarEntry[] = [];
  const workday: CalendarEntry[] = [];
  const evening: CalendarEntry[] = [];

  for (const event of events) {
    if (event.isAllDay) {
      allDay.push(event);
    } else if (event.startHour != null && event.startHour < 9) {
      morning.push(event);
    } else if (event.startHour != null && event.startHour >= 17) {
      evening.push(event);
    } else {
      workday.push(event);
    }
  }

  const currentHour = new Date().getHours();
  const currentBlock = currentHour < 9 ? 'morning' : currentHour < 17 ? 'workday' : 'evening';

  const sections: Section[] = [];
  if (allDay.length > 0) sections.push({ label: 'All day', events: allDay });
  if (morning.length > 0 && currentBlock === 'morning') sections.push({ label: 'This morning', events: morning });
  if (workday.length > 0 && (currentBlock === 'morning' || currentBlock === 'workday')) sections.push({ label: 'The workday', events: workday });
  if (evening.length > 0) sections.push({ label: 'This evening', events: evening });
  return sections;
}

export function TodaySchedule() {
  const [events, setEvents] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

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

  const sections = groupBySection(events);

  return (
    <div className="space-y-3">
      <button
        onClick={() => setShowAll(!showAll)}
        className="flex items-center gap-2 hover:text-foreground transition-colors"
      >
        <Clock className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          {events.length} event{events.length !== 1 ? 's' : ''} today
        </span>
      </button>
      {showAll && (
        <div className="space-y-2 border-t border-border pt-3">
          {events.map((event, i) => (
            <div key={i} className="flex items-start gap-3 text-sm">
              <span className="w-20 shrink-0 text-muted-foreground font-mono text-xs pt-0.5">
                {event.time}
              </span>
              <span className="truncate">{event.title}</span>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-4">
        {sections.map((section) => (
          <div key={section.label} className="space-y-2">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {section.label}
            </h4>
            {section.events.map((event, i) => (
              <div key={i} className="flex items-start gap-3 text-sm">
                <span className="w-20 shrink-0 text-muted-foreground font-mono text-xs pt-0.5">
                  {event.time}
                </span>
                <span className="truncate">{event.title}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
