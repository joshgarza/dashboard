import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { CheckSquare, Check, Circle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { config } from '@/config';

interface DailyTask {
  text: string;
  source: string;
  completed: boolean;
}

interface DailyPlan {
  focus: string;
  tasks: DailyTask[];
}

interface TodayData {
  plan: DailyPlan | null;
  goals: string[];
}

export function TodayTodos() {
  const [interviewNeeded, setInterviewNeeded] = useState<boolean | null>(null);
  const [todayData, setTodayData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${config.apiBaseUrl}/api/weekly-review/status`)
      .then(res => res.json())
      .then(json => {
        if (json.success) {
          setInterviewNeeded(json.data.needed);
          if (!json.data.needed) {
            return fetch(`${config.apiBaseUrl}/api/weekly-review/today`)
              .then(res => res.json())
              .then(todayJson => {
                if (todayJson.success) {
                  setTodayData(todayJson.data);
                }
              });
          }
        } else {
          const msg = typeof json.error === 'object' ? json.error?.message : json.error;
          setError(msg || 'Failed to load status');
        }
      })
      .catch(() => {
        setError('Failed to load weekly review status');
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  async function handleToggle(index: number) {
    if (!todayData?.plan) return;

    // Optimistic update
    setTodayData(prev => {
      if (!prev?.plan) return prev;
      const tasks = [...prev.plan.tasks];
      tasks[index] = { ...tasks[index], completed: !tasks[index].completed };
      return { ...prev, plan: { ...prev.plan, tasks } };
    });

    try {
      const res = await fetch(`${config.apiBaseUrl}/api/weekly-review/today/${index}/toggle`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!json.success) {
        // Revert on failure
        setTodayData(prev => {
          if (!prev?.plan) return prev;
          const tasks = [...prev.plan.tasks];
          tasks[index] = { ...tasks[index], completed: !tasks[index].completed };
          return { ...prev, plan: { ...prev.plan, tasks } };
        });
      }
    } catch {
      // Revert on failure
      setTodayData(prev => {
        if (!prev?.plan) return prev;
        const tasks = [...prev.plan.tasks];
        tasks[index] = { ...tasks[index], completed: !tasks[index].completed };
        return { ...prev, plan: { ...prev.plan, tasks } };
      });
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-full" />
      </div>
    );
  }

  if (error) {
    return <div className="text-destructive text-sm">{error}</div>;
  }

  // State 1: Interview needed
  if (interviewNeeded) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <CheckSquare className="h-5 w-5" />
          <span className="text-lg font-semibold">Weekly Review</span>
        </div>
        <p className="text-sm text-muted-foreground">
          Plan your week in a 5-min chat with your planning assistant
        </p>
        <Link
          to="/weekly-review"
          className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Start Weekly Review
        </Link>
      </div>
    );
  }

  const plan = todayData?.plan;
  const goals = todayData?.goals || [];

  // No plan for today
  if (!plan) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Check className="h-5 w-5 text-green-500" />
          <span className="text-lg font-semibold">No tasks for today</span>
        </div>
        <Link to="/weekly-review" className="text-xs text-muted-foreground hover:underline">
          Redo Review
        </Link>
      </div>
    );
  }

  const completedCount = plan.tasks.filter(t => t.completed).length;
  const allDone = completedCount === plan.tasks.length;

  // State 3: All done
  if (allDone && plan.tasks.length > 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Check className="h-5 w-5 text-green-500" />
          <span className="text-lg font-semibold">All done for today!</span>
        </div>
        <Link to="/weekly-review" className="text-xs text-muted-foreground hover:underline">
          Redo Review
        </Link>
      </div>
    );
  }

  // State 2: Today's tasks
  return (
    <div className="space-y-3">
      {goals.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">Goals:</span> {goals.join(', ')}
        </div>
      )}
      {plan.focus && (
        <div className="text-sm font-medium">
          Focus: {plan.focus}
        </div>
      )}
      <div className="space-y-1.5">
        {plan.tasks.map((task, i) => (
          <button
            key={i}
            onClick={() => handleToggle(i)}
            className="flex items-center gap-2 w-full text-left text-sm hover:bg-muted/50 rounded px-1 py-0.5 transition-colors"
          >
            {task.completed ? (
              <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            )}
            <span className={task.completed ? 'line-through text-muted-foreground' : ''}>
              {task.text}
            </span>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {completedCount}/{plan.tasks.length} complete
        </span>
        <Link to="/weekly-review" className="text-xs text-muted-foreground hover:underline">
          Redo Review
        </Link>
      </div>
    </div>
  );
}
