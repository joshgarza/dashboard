import { useState, useEffect } from 'react';
import { Briefcase } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { config } from '@/config';

interface PipelineData {
  total: number;
  stages: Record<string, number>;
}

export function JobPipeline() {
  const [data, setData] = useState<PipelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${config.apiBaseUrl}/api/crm/pipeline`)
      .then(res => res.json())
      .then(json => {
        if (json.success) {
          setData(json.data);
        } else {
          setError(json.error || 'Failed to load pipeline data');
        }
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load pipeline data');
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

  if (error) {
    return <div className="text-destructive text-sm">{error}</div>;
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Briefcase className="h-5 w-5" />
        <span className="text-lg font-semibold">{data.total} opportunities</span>
      </div>

      <div className="space-y-3">
        {Object.entries(data.stages).map(([stage, count]) => (
          <div key={stage} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span>{stage}</span>
              <span className="text-muted-foreground">{count}</span>
            </div>
            <Progress value={(count / data.total) * 100} className="h-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
