import { useState, useEffect } from 'react';
import { Users } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { config } from '@/config';

interface ContactsData {
  total: number;
  stages: Record<string, number>;
  imminentFollowUps: number;
}

interface FocusItem {
  headline: string;
  detail: string;
}

function getContactsFocus(stages: Record<string, number>, imminentFollowUps: number): FocusItem[] {
  const meetingScheduled = stages['Meeting Scheduled'] ?? 0;
  const hot = stages['Hot'] ?? 0;
  const warm = stages['Warm'] ?? 0;
  const cold = stages['Cold'] ?? 0;

  const items: FocusItem[] = [];

  if (meetingScheduled >= 1) {
    items.push({
      headline: 'Prep for meetings',
      detail: `${meetingScheduled} meeting${meetingScheduled !== 1 ? 's' : ''} scheduled`,
    });
  }
  if (imminentFollowUps >= 1) {
    items.push({
      headline: imminentFollowUps === 1 ? 'Follow up with a contact' : 'Follow up with contacts',
      detail: `${imminentFollowUps} contact${imminentFollowUps !== 1 ? 's' : ''} need follow-up soon`,
    });
  }
  if (hot >= 1) {
    items.push({
      headline: 'Book meetings with hot leads',
      detail: `${hot} hot lead${hot !== 1 ? 's' : ''} ready`,
    });
  }
  if (warm >= 1) {
    items.push({
      headline: 'Nurture warm contacts',
      detail: `${warm} warm contact${warm !== 1 ? 's' : ''} to engage`,
    });
  }
  if (cold > 0) {
    items.push({
      headline: 'Start warming cold contacts',
      detail: `${cold} cold contact${cold !== 1 ? 's' : ''} in the pipeline`,
    });
  }

  if (items.length === 0) {
    items.push({ headline: 'Expand your network', detail: 'Add new contacts to get started' });
  }

  return items.slice(0, 2);
}

export function Contacts() {
  const [data, setData] = useState<ContactsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${config.apiBaseUrl}/api/crm/contacts`)
      .then(res => res.json())
      .then(json => {
        if (json.success) {
          setData(json.data);
        } else {
          setError(json.error || 'Failed to load contacts');
        }
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load contacts');
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }

  if (error) return <div className="text-destructive text-sm">{error}</div>;
  if (!data) return null;

  const items = getContactsFocus(data.stages, data.imminentFollowUps);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5" />
        <span className="text-lg font-semibold">Contacts</span>
      </div>
      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={i} className="space-y-0.5">
            <p className="text-base font-medium">{item.headline}</p>
            <p className="text-sm text-muted-foreground">{item.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
