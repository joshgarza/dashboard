import { useState, useEffect } from 'react';
import { Briefcase } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { config } from '@/config';

interface PipelineData {
  total: number;
  stages: Record<string, number>;
}

interface FocusItem {
  headline: string;
  detail: string;
}

function getJobFocus(stages: Record<string, number>): FocusItem[] {
  const interview = stages['Interview'] ?? 0;
  const awaitingResponse = stages['Awaiting Response'] ?? 0;
  const screening = stages['Screening'] ?? 0;
  const applied = stages['Applied'] ?? 0;
  const toApply = stages['To Apply'] ?? 0;

  const items: FocusItem[] = [];

  if (interview >= 1) {
    items.push({
      headline: interview === 1 ? 'Prep for your interview' : 'Focus on interview prep',
      detail: interview === 1 ? '1 interview coming up' : `${interview} interviews in progress`,
    });
  }
  if (awaitingResponse >= 1) {
    items.push({
      headline: 'Follow up on your interviews',
      detail: `${awaitingResponse} ${awaitingResponse !== 1 ? 'companies haven\'t' : 'company hasn\'t'} responded`,
    });
  }
  if (screening >= 1) {
    items.push({
      headline: screening === 1 ? 'Prep for your screening call' : 'Prep for screening calls',
      detail: screening === 1 ? '1 screening scheduled' : `${screening} screenings scheduled`,
    });
  }
  if (applied >= 10) {
    items.push({
      headline: 'Follow up on applications',
      detail: `${applied} applications out there`,
    });
  }
  if (toApply >= 1) {
    items.push({
      headline: 'Submit your applications',
      detail: `${toApply} job${toApply !== 1 ? 's' : ''} queued to apply`,
    });
  }

  if (items.length === 0) {
    items.push({ headline: 'Find more jobs to apply to', detail: 'Start adding to your pipeline' });
  }

  return items.slice(0, 2);
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
          const errorMsg = typeof json.error === 'object' ? json.error?.message : json.error;
          setError(errorMsg || 'Failed to load pipeline data');
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
      <div className="space-y-3">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }

  if (error) {
    return <div className="text-destructive text-sm">{error}</div>;
  }

  if (!data) return null;

  const items = getJobFocus(data.stages);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Briefcase className="h-5 w-5" />
        <span className="text-lg font-semibold">Job Pipeline</span>
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
