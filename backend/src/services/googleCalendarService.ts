interface CalendarEvent {
  status: string;
  summary?: string;
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
}

export async function getTodayEvents(
  apiKey: string,
  calendarId: string
): Promise<CalendarEntry[]> {
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
  // timeMax is exclusive in the Google Calendar API, so use midnight of the next day
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone });
  const timeMax = `${tomorrowStr}T00:00:00${offset}`;

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
    throw new Error(`Google Calendar API error (${response.status}): ${text}`);
  }

  const data: CalendarApiResponse = await response.json();
  const events = (data.items ?? []).filter((e) => e.status !== 'cancelled');

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

    return {
      time,
      title: event.summary ?? '(No title)',
      isAllDay,
    };
  });

  // Sort all-day events to the top
  entries.sort((a, b) => {
    if (a.isAllDay && !b.isAllDay) return -1;
    if (!a.isAllDay && b.isAllDay) return 1;
    return 0;
  });

  return entries;
}
