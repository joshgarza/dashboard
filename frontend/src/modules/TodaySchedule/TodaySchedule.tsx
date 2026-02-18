import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { config } from '@/config';

interface CalendarEntry {
  time: string;
  title: string;
  isAllDay: boolean;
  startHour?: number;
  day: 'today' | 'tomorrow';
}

interface Section {
  label: string;
  events: CalendarEntry[];
}

interface GroupedSections {
  active: Section[];
  past: Section[];
}

type BlockKey = 'morning' | 'workday' | 'evening' | 'tomorrowMorning' | 'tomorrowWorkday' | 'tomorrowEvening';

const blockOrder: BlockKey[] = ['morning', 'workday', 'evening', 'tomorrowMorning', 'tomorrowWorkday', 'tomorrowEvening'];

function getBlockLabels(currentHour: number): Record<BlockKey, string> {
  const isLateNight = currentHour < 5;
  return {
    morning: isLateNight ? 'Tomorrow morning' : 'This morning',
    workday: isLateNight ? 'Tomorrow afternoon' : 'The workday',
    evening: isLateNight ? 'Tomorrow evening' : 'This evening',
    tomorrowMorning: 'Tomorrow morning',
    tomorrowWorkday: 'Tomorrow afternoon',
    tomorrowEvening: 'Tomorrow evening',
  };
}

function getBlock(event: CalendarEntry): BlockKey {
  const hour = event.startHour ?? 0;
  if (event.day === 'tomorrow') {
    if (hour < 9) return 'tomorrowMorning';
    if (hour < 17) return 'tomorrowWorkday';
    return 'tomorrowEvening';
  }
  if (hour < 9) return 'morning';
  if (hour < 17) return 'workday';
  return 'evening';
}

function groupBySection(events: CalendarEntry[], currentHour: number): GroupedSections {
  const allDay: CalendarEntry[] = [];
  const buckets: Record<BlockKey, CalendarEntry[]> = {
    morning: [], workday: [], evening: [],
    tomorrowMorning: [], tomorrowWorkday: [], tomorrowEvening: [],
  };

  for (const event of events) {
    if (event.isAllDay) {
      allDay.push(event);
    } else {
      buckets[getBlock(event)].push(event);
    }
  }

  const labels = getBlockLabels(currentHour);
  const currentBlockIndex = currentHour < 9 ? 0 : currentHour < 17 ? 1 : 2;

  const active: Section[] = [];
  const past: Section[] = [];

  if (allDay.length > 0) active.push({ label: 'All day', events: allDay });

  for (let i = 0; i < blockOrder.length; i++) {
    const key = blockOrder[i];
    if (buckets[key].length === 0) continue;
    const section: Section = { label: labels[key], events: buckets[key] };
    if (i < currentBlockIndex) {
      past.push(section);
    } else {
      active.push(section);
    }
  }

  return { active, past };
}

export function TodaySchedule() {
  const [events, setEvents] = useState<CalendarEntry[]>([]);
  const [currentHour, setCurrentHour] = useState(new Date().getHours());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    fetch(`${config.apiBaseUrl}/api/calendar/today`)
      .then(res => res.json())
      .then(json => {
        if (json.success) {
          setEvents(json.data);
          if (json.currentHour != null) setCurrentHour(json.currentHour);
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
        No events in the next 24 hours
      </div>
    );
  }

  const { active, past } = groupBySection(events, currentHour);

  return (
    <div className="space-y-3">
      {past.length > 0 && (
        <button
          onClick={() => setShowPast(!showPast)}
          className="flex items-center gap-2 cursor-pointer hover:text-foreground transition-colors"
        >
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {events.length} event{events.length !== 1 ? 's' : ''} today
          </span>
        </button>
      )}
      {showPast && past.length > 0 && (
        <div className="space-y-4 border-t border-border pt-3">
          {past.map((section) => (
            <div key={section.label} className="space-y-2">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {section.label}
              </h4>
              {section.events.map((event, i) => (
                <div key={i} className="flex items-start gap-3 text-sm opacity-50">
                  <span className="w-20 shrink-0 text-muted-foreground font-mono text-xs pt-0.5">
                    {event.time}
                  </span>
                  <span className="truncate">{event.title}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="space-y-4">
        {active.map((section) => (
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
