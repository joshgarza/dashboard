import { useState, useEffect } from 'react';
import { CheckSquare } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { config } from '@/config';

interface TodoSummary {
  noteTitle: string;
  completed: number;
  total: number;
  weekOf: string;
}

export function WeeklyTodos() {
  const [data, setData] = useState<TodoSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${config.apiBaseUrl}/api/obsidian/weekly-todos`)
      .then(res => res.json())
      .then(json => {
        if (json.success) {
          setData(json.data);
        } else {
          const errorMsg = typeof json.error === 'object' ? json.error?.message : json.error;
          setError(errorMsg || 'Failed to load weekly todos');
        }
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load weekly todos');
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-2 w-full" />
      </div>
    );
  }

  if (error) {
    return <div className="text-destructive text-sm">{error}</div>;
  }

  if (!data) return null;

  const percentage = data.total > 0 ? (data.completed / data.total) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <CheckSquare className="h-5 w-5" />
        <span className="text-lg font-semibold">
          {data.completed}/{data.total} tasks complete
        </span>
      </div>
      <Progress value={percentage} className="h-2" />
      <div className="text-sm text-muted-foreground">
        Week of {data.weekOf}
      </div>
    </div>
  );
}
