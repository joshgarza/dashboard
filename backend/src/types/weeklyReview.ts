export interface DailyTask {
  id: number;          // svc_weekly_review_tasks.id
  thought_id: number | null;
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

export interface WeeklyReviewProfileStateEntry {
  key: string;
  value: string | number | boolean;
  confidence: number;
  updatedAt: string;
}

export interface WeeklyReviewMemoryEvidence {
  sourceType: string;
  sourceRef: string;
  excerpt: string;
  weight: number;
}

export interface WeeklyReviewMemoryItem {
  id: number;
  kind: string;
  normalizedKey: string | null;
  summary: string;
  detail: Record<string, unknown>;
  confidence: number;
  status: 'active' | 'superseded' | 'archived';
  reviewSnapshotId: number | null;
  supersedesMemoryId: number | null;
  createdAt: string;
  updatedAt: string;
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

export interface LearningProfile {
  energy_patterns: {
    notes: string;
  };
  work_preferences: {
    max_daily_tasks: number;
    prefers_deep_work_mornings: boolean;
  };
  completion_patterns: {
    avg_weekly_completion: number;
    commonly_deferred: string[];
    commonly_completed_first: string[];
  };
  review_history: Array<{
    week: string;
    planned: number;
    completed: number;
    notes: string;
  }>;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface InterviewStatus {
  needed: boolean;
  week: string;
}

export interface WeeklyContext {
  currentTodos: string;
  previousWeekSummary: string;
  currentWeekContext: string; // non-empty when a plan already exists for this week (redo case)
  profileStateSummary: string;
  relevantMemorySummary: string;
  recentOutcomeSummary: string;
}
