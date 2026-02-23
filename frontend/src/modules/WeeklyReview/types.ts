export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface DailyTask {
  text: string;
  source: string;
  completed: boolean;
}

export interface DailyPlan {
  focus: string;
  tasks: DailyTask[];
}

export interface WeeklyPlan {
  week: string;
  interviewedAt: string;
  weeklyGoals: string[];
  days: Record<string, DailyPlan>;
  unscheduled: string[];
  dropped: string[];
}
