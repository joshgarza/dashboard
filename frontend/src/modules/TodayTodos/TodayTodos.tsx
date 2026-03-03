import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { CheckSquare, Check, Circle, ChevronLeft, ChevronRight } from 'lucide-react';
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
  today: string;
}

function addDays(dateStr: string, n: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0);
  date.setDate(date.getDate() + n);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDayLabel(dateStr: string, todayStr: string): string {
  if (!dateStr || !todayStr) return '';
  if (dateStr === todayStr) return 'Today';
  if (dateStr === addDays(todayStr, -1)) return 'Yesterday';
  if (dateStr === addDays(todayStr, 1)) return 'Tomorrow';
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function getClientToday(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function TodayTodos() {
  const [interviewNeeded, setInterviewNeeded] = useState<boolean | null>(null);
  const [todayData, setTodayData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [todayStr, setTodayStr] = useState<string>('');
  const [showDoneTasks, setShowDoneTasks] = useState(false);

  useEffect(() => {
    setShowDoneTasks(false);
  }, [selectedDate]);

  async function fetchDayPlan(dateStr: string) {
    setLoading(true);
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/weekly-review/day/${dateStr}`);
      const json = await res.json();
      if (json.success) {
        setTodayData(json.data);
        setTodayStr(json.data.today);
      }
    } catch {
      // swallow navigation errors silently
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const clientToday = getClientToday();
    fetch(`${config.apiBaseUrl}/api/weekly-review/status`)
      .then(res => res.json())
      .then(json => {
        if (json.success) {
          setInterviewNeeded(json.data.needed);
          if (!json.data.needed) {
            setSelectedDate(clientToday);
            return fetchDayPlan(clientToday);
          }
        } else {
          const msg = typeof json.error === 'object' ? json.error?.message : json.error;
          setError(msg || 'Failed to load status');
        }
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load weekly review status');
        setLoading(false);
      });
  }, []);

  async function handleToggle(index: number) {
    if (!todayData?.plan) return;

    setTodayData(prev => {
      if (!prev?.plan) return prev;
      const tasks = [...prev.plan.tasks];
      tasks[index] = { ...tasks[index], completed: !tasks[index].completed };
      return { ...prev, plan: { ...prev.plan, tasks } };
    });

    try {
      const res = await fetch(
        `${config.apiBaseUrl}/api/weekly-review/day/${selectedDate}/${index}/toggle`,
        { method: 'POST' },
      );
      const json = await res.json();
      if (!json.success) {
        setTodayData(prev => {
          if (!prev?.plan) return prev;
          const tasks = [...prev.plan.tasks];
          tasks[index] = { ...tasks[index], completed: !tasks[index].completed };
          return { ...prev, plan: { ...prev.plan, tasks } };
        });
      }
    } catch {
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
  const isToday = selectedDate === todayStr;

  const navStrip = (
    <div className="flex items-center justify-between">
      <button
        onClick={() => {
          const newDate = addDays(selectedDate, -1);
          setSelectedDate(newDate);
          void fetchDayPlan(newDate);
        }}
        className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Previous day"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="text-sm font-medium">{formatDayLabel(selectedDate, todayStr)}</span>
      <button
        onClick={() => {
          const newDate = addDays(selectedDate, 1);
          setSelectedDate(newDate);
          void fetchDayPlan(newDate);
        }}
        className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Next day"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );

  const backToToday = !isToday && (
    <button
      onClick={() => {
        setSelectedDate(todayStr);
        void fetchDayPlan(todayStr);
      }}
      className="text-xs text-muted-foreground hover:underline"
    >
      Back to today
    </button>
  );

  if (!plan) {
    return (
      <div className="space-y-3">
        {navStrip}
        {backToToday}
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
  const allDone = completedCount === plan.tasks.length && plan.tasks.length > 0;

  if (allDone && isToday) {
    return (
      <div className="space-y-3">
        {navStrip}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Check className="h-5 w-5 text-green-500" />
            <span className="text-lg font-semibold">All done for today!</span>
          </div>
          <button
            onClick={() => setShowDoneTasks(p => !p)}
            className="text-xs text-muted-foreground hover:underline"
          >
            {showDoneTasks ? 'Hide' : 'Show tasks'}
          </button>
        </div>
        {showDoneTasks && (
          <div className="space-y-1.5">
            {plan.tasks.map((task, i) => (
              <button
                key={i}
                onClick={() => handleToggle(i)}
                className="flex items-center gap-2 w-full text-left text-sm hover:bg-muted/50 rounded px-1 py-0.5 transition-colors"
              >
                <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                <span className="line-through text-muted-foreground">{task.text}</span>
              </button>
            ))}
          </div>
        )}
        <Link to="/weekly-review" className="text-xs text-muted-foreground hover:underline">
          Redo Review
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {navStrip}
      {backToToday}
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
