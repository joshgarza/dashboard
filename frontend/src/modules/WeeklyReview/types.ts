export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface DailyTask {
  id?: number;
  thought_id?: number | null;
  text: string;
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

export interface WeeklyReviewCompletionSummary {
  completedCount: number;
  assignedCount: number;
}

export interface WeeklyReviewSummary {
  id: number;
  week: string;
  interviewedAt: string;
  weeklyGoals: string[];
  dayCount: number;
  taskCount: number;
  completionSummary: WeeklyReviewCompletionSummary | null;
}

export interface WeeklyReviewRecord extends WeeklyReviewSummary {
  plan: WeeklyPlan;
}

export interface FinalizedWeeklyReview {
  reviewId: number;
  plan: WeeklyPlan;
}
