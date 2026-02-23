import { Button } from '@/components/ui/button';
import type { WeeklyPlan } from './types';

interface PlanPreviewProps {
  plan: WeeklyPlan;
  onAccept: () => void;
  onBack: () => void;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

export function PlanPreview({ plan, onAccept, onBack }: PlanPreviewProps) {
  const sortedDays = Object.entries(plan.days).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-y-auto">
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

      <div className="flex gap-2 pt-2">
        <Button onClick={onAccept}>Accept Plan</Button>
        <Button variant="outline" onClick={onBack}>Back to Chat</Button>
      </div>
    </div>
  );
}
