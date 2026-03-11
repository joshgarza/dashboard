import { Button } from '@/components/ui/button';
import type { WeeklyPlan } from './types';

interface PlanPreviewProps {
  plan: WeeklyPlan;
  title?: string;
  subtitle?: string;
  notice?: string;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

export function PlanPreview({
  plan,
  title,
  subtitle,
  notice,
  primaryActionLabel,
  onPrimaryAction,
  secondaryActionLabel,
  onSecondaryAction,
}: PlanPreviewProps) {
  const sortedDays = Object.entries(plan.days).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="flex flex-col gap-4 pb-8">
      {(title || subtitle) && (
        <div className="space-y-1">
          {title && <h2 className="text-xl font-semibold text-foreground">{title}</h2>}
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      )}

      {notice && (
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground">
          {notice}
        </div>
      )}

      {plan.weeklyGoals.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-1">Weekly Goals</h3>
          <ul className="list-disc list-inside text-sm text-muted-foreground">
            {plan.weeklyGoals.map((goal, i) => (
              <li key={i}>{goal}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-4">
        {sortedDays.map(([date, dayPlan]) => (
          <div key={date} className="border rounded-md p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">{formatDate(date)}</h3>
              <span className="text-xs text-muted-foreground">
                {dayPlan.tasks.length} task{dayPlan.tasks.length !== 1 ? 's' : ''}
              </span>
            </div>
            {dayPlan.focus && (
              <p className="text-xs text-muted-foreground mb-2">Focus: {dayPlan.focus}</p>
            )}
            <ul className="space-y-1">
              {dayPlan.tasks.map((task, i) => (
                <li key={i} className="text-sm flex items-start gap-2">
                  <span className="text-muted-foreground mt-0.5">-</span>
                  <span>{task.text}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {plan.unscheduled.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-1">Deferred</h3>
          <ul className="list-disc list-inside text-sm text-muted-foreground">
            {plan.unscheduled.map((task, i) => (
              <li key={i}>{task}</li>
            ))}
          </ul>
        </div>
      )}

      {plan.dropped.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-1">Dropped</h3>
          <ul className="list-disc list-inside text-sm text-muted-foreground line-through">
            {plan.dropped.map((task, i) => (
              <li key={i}>{task}</li>
            ))}
          </ul>
        </div>
      )}

      {(onPrimaryAction || onSecondaryAction) && (
        <div className="flex gap-2 pt-2">
          {onPrimaryAction && (
            <Button onClick={onPrimaryAction}>{primaryActionLabel ?? 'Continue'}</Button>
          )}
          {onSecondaryAction && (
            <Button variant="outline" onClick={onSecondaryAction}>
              {secondaryActionLabel ?? 'Back'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
