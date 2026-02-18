interface CalendarEvent {
  status: string;
  summary?: string;
  eventType?: string;
  start: {
    dateTime?: string;
    date?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
  };
}

interface CalendarApiResponse {
  timeZone?: string;
  items?: CalendarEvent[];
}

export interface CalendarEntry {
  time: string;
  title: string;
  isAllDay: boolean;
  startHour?: number;
  day: 'today' | 'tomorrow';
}

export interface CalendarResponse {
  events: CalendarEntry[];
  currentHour: number;
}

export async function getTodayEvents(
  apiKey: string,
  calendarIds: string[]
): Promise<CalendarResponse> {
  // Use the calendar's timezone for day boundaries so the container's
  // UTC clock doesn't shift which "today" we query for.
  const timeZone = process.env.TZ || 'America/Los_Angeles';
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA', { timeZone });

  // Compute the UTC offset for this timezone to build RFC3339 timestamps
  const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = now.toLocaleString('en-US', { timeZone });
  const diffMs = new Date(tzStr).getTime() - new Date(utcStr).getTime();
  const diffHours = Math.floor(Math.abs(diffMs) / 3600000);
  const diffMins = Math.floor((Math.abs(diffMs) % 3600000) / 60000);
  const sign = diffMs >= 0 ? '+' : '-';
  const offset = `${sign}${String(diffHours).padStart(2, '0')}:${String(diffMins).padStart(2, '0')}`;

  const timeMin = `${todayStr}T00:00:00${offset}`;
  // Fetch up to 24 hours from now (plus today's past events for the history toggle)
  const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const endStr = end.toLocaleDateString('en-CA', { timeZone });
  const endTime = end.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
  const timeMax = `${endStr}T${endTime}:00${offset}`;

  // Fetch events from all calendars in parallel
  const allEvents = await Promise.all(calendarIds.map(async (calendarId) => {
    const params = new URLSearchParams({
      key: apiKey,
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
    });

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
    const response = await fetch(url);

    if (!response.ok) {
      const text = await response.text();
      console.error(`Google Calendar API error for ${calendarId} (${response.status}): ${text}`);
      return [];
    }

    const data: CalendarApiResponse = await response.json();
    return (data.items ?? []).filter((e) => e.status !== 'cancelled' && e.eventType !== 'workingLocation');
  }));

  const events = allEvents.flat();

  const entries: CalendarEntry[] = events.map((event) => {
    const isAllDay = !event.start.dateTime;
    let time = 'All day';

    if (!isAllDay && event.start.dateTime) {
      time = new Date(event.start.dateTime).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone,
      });
    }

    const startHour = !isAllDay && event.start.dateTime
      ? parseInt(new Date(event.start.dateTime).toLocaleTimeString('en-US', { hour: 'numeric', hour12: false, timeZone }), 10)
      : undefined;

    const eventDate = event.start.dateTime
      ? new Date(event.start.dateTime).toLocaleDateString('en-CA', { timeZone })
      : event.start.date;
    const day: 'today' | 'tomorrow' = eventDate === todayStr ? 'today' : 'tomorrow';

    return {
      time,
      title: event.summary ?? '(No title)',
      isAllDay,
      startHour,
      day,
    };
  });

  // Sort: all-day first, then by start time
  entries.sort((a, b) => {
    if (a.isAllDay && !b.isAllDay) return -1;
    if (!a.isAllDay && b.isAllDay) return 1;
    if (a.day !== b.day) return a.day === 'today' ? -1 : 1;
    return (a.startHour ?? 0) - (b.startHour ?? 0);
  });

  const currentHour = parseInt(new Date().toLocaleTimeString('en-US', { hour: 'numeric', hour12: false, timeZone }), 10);

  return { events: entries, currentHour };
}
