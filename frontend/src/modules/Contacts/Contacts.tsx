import { useState, useEffect } from 'react';
import { Users } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { config } from '@/config';

// 1. Define the specific order as a constant
const STAGE_ORDER = [
  'Cold',
  'Warm',
  'Hot',
  'Meeting Scheduled',
  'Follow-Up',
  'Post-Meeting',
  'Archive'
] as const;

interface ContactsData {
  total: number;
  stages: Record<string, number>;
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
      <div className="space-y-4">
        <Skeleton className="h-6 w-1/3" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-2 w-3/4" />
        </div>
      </div>
    );
  }

  if (error) return <div className="text-destructive text-sm">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5" />
        <span className="text-lg font-semibold">{data.total} contacts</span>
      </div>

      <div className="space-y-3">
        {/* 2. Map over the ordered array instead of Object.entries */}
        {STAGE_ORDER.map((stage) => {
          const count = data.stages[stage] ?? 0; // Default to 0 if missing from API
          const percentage = data.total > 0 ? (count / data.total) * 100 : 0;

          return (
            <div key={stage} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span>{stage}</span>
                <span className="text-muted-foreground">{count}</span>
              </div>
              <Progress value={percentage} className="h-2" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
