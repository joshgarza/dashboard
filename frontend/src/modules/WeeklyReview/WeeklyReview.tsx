import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { config } from '@/config';
import { InterviewChat } from './InterviewChat';
import { PlanPreview } from './PlanPreview';
import { ReviewSidebar } from './ReviewSidebar';
import type {
  ChatMessage,
  FinalizedWeeklyReview,
  WeeklyPlan,
  WeeklyReviewCompletionSummary,
  WeeklyReviewRecord,
  WeeklyReviewSummary,
} from './types';

type DraftPhase = 'idle' | 'interview' | 'preview';
type TouchState = {
  x: number;
  y: number;
};

function sortReviews(reviews: WeeklyReviewSummary[]): WeeklyReviewSummary[] {
  return [...reviews].sort((a, b) => {
    const timestampDelta = new Date(b.interviewedAt).getTime() - new Date(a.interviewedAt).getTime();
    if (timestampDelta !== 0) {
      return timestampDelta;
    }
    return b.id - a.id;
  });
}

function getReviewTitle(review: Pick<WeeklyReviewSummary, 'week' | 'weeklyGoals'>): string {
  return review.weeklyGoals[0] ?? `Weekly review ${review.week}`;
}

function formatReviewDetails(interviewedAt: string): string {
  const reviewedAt = new Date(interviewedAt);
  const reviewedLabel = reviewedAt.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  return `Reviewed ${reviewedLabel}`;
}

function formatCompletionNotice(completionSummary: WeeklyReviewCompletionSummary | null): string | null {
  if (!completionSummary) {
    return null;
  }

  return `Completed ${completionSummary.completedCount} of ${completionSummary.assignedCount} assigned tasks that week.`;
}

function countPlanTasks(plan: WeeklyPlan): number {
  return Object.values(plan.days).reduce((count, day) => count + day.tasks.length, 0);
}

function buildReviewSummary(reviewId: number, plan: WeeklyPlan): WeeklyReviewSummary {
  return {
    id: reviewId,
    week: plan.week,
    interviewedAt: plan.interviewedAt,
    weeklyGoals: plan.weeklyGoals,
    dayCount: Object.keys(plan.days).length,
    taskCount: countPlanTasks(plan),
    completionSummary: null,
  };
}

export function WeeklyReview() {
  const navigate = useNavigate();
  const [reviews, setReviews] = useState<WeeklyReviewSummary[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [draftPhase, setDraftPhase] = useState<DraftPhase>('idle');
  const [draftPlan, setDraftPlan] = useState<WeeklyPlan | null>(null);
  const [activeReviewId, setActiveReviewId] = useState<number | null>(null);
  const [activeReview, setActiveReview] = useState<WeeklyReviewRecord | null>(null);
  const [activeReviewLoading, setActiveReviewLoading] = useState(false);
  const [chatStreaming, setChatStreaming] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const touchStartRef = useRef<TouchState | null>(null);

  const upsertReviewSummary = useCallback((summary: WeeklyReviewSummary) => {
    setReviews((prev) => {
      const next = prev.filter((review) => review.id !== summary.id);
      next.push(summary);
      return sortReviews(next);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadReviews() {
      try {
        const response = await fetch(`${config.apiBaseUrl}/api/weekly-review/reviews`);
        const json = await response.json();
        if (!cancelled && response.ok && json.success) {
          setReviews(sortReviews(json.data as WeeklyReviewSummary[]));
        }
      } catch {
        if (!cancelled) {
          setReviews([]);
        }
      } finally {
        if (!cancelled) {
          setReviewsLoading(false);
        }
      }
    }

    void loadReviews();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeReviewId) {
      setActiveReviewLoading(false);
      setActiveReview(null);
      return;
    }

    if (activeReview?.id === activeReviewId) {
      return;
    }

    let cancelled = false;
    setActiveReviewLoading(true);

    void (async () => {
      try {
        const response = await fetch(`${config.apiBaseUrl}/api/weekly-review/reviews/${activeReviewId}`);
        const json = await response.json();
        if (!cancelled && response.ok && json.success) {
          setActiveReview(json.data as WeeklyReviewRecord);
        } else if (!cancelled) {
          setActiveReview(null);
          setError('Failed to load review');
        }
      } catch {
        if (!cancelled) {
          setActiveReview(null);
          setError('Failed to load review');
        }
      } finally {
        if (!cancelled) {
          setActiveReviewLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeReview?.id, activeReviewId]);

  const sidebarDisabled = chatStreaming || finalizing;
  const showingDraft = activeReviewId === null;
  const recentReviews = useMemo(() => reviews.slice(0, 5), [reviews]);

  async function handleFinalize(messages: ChatMessage[]) {
    setFinalizing(true);
    setError(null);

    try {
      const response = await fetch(`${config.apiBaseUrl}/api/weekly-review/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });

      const json = await response.json();
      if (response.ok && json.success) {
        const data = json.data as FinalizedWeeklyReview;
        setDraftPlan(data.plan);
        setDraftPhase('preview');
        upsertReviewSummary(buildReviewSummary(data.reviewId, data.plan));
      } else {
        const message = typeof json.error === 'object' ? json.error?.message : json.error;
        setError(message || 'Failed to generate plan');
      }
    } catch {
      setError('Failed to generate plan');
    } finally {
      setFinalizing(false);
    }
  }

  function handleAccept() {
    navigate('/');
  }

  function handleBackToInterview() {
    setError(null);
    setDraftPhase('interview');
    setActiveReviewId(null);
    setMobileSidebarOpen(false);
  }

  function handleNewReview() {
    setActiveReviewId(null);
    setActiveReview(null);
    setDraftPhase('idle');
    setDraftPlan(null);
    setError(null);
    setMobileSidebarOpen(false);
  }

  function handleOpenDraftInterview() {
    setActiveReviewId(null);
    setActiveReview(null);
    setDraftPhase('interview');
    setError(null);
    setMobileSidebarOpen(false);
  }

  function handleSelectReview(reviewId: number) {
    setActiveReviewId(reviewId);
    setError(null);
    setMobileSidebarOpen(false);
  }

  const mobileTitle = showingDraft
    ? draftPhase === 'preview'
      ? 'Plan preview'
      : draftPhase === 'interview'
        ? 'New review'
        : 'Weekly Review'
    : activeReview?.weeklyGoals[0] ?? 'Saved review';

  const mobileSubtitle = showingDraft
    ? draftPhase === 'preview'
      ? 'Draft plan'
      : draftPhase === 'interview'
        ? 'Draft in progress'
        : 'Choose where to start'
    : activeReview
      ? formatReviewDetails(activeReview.interviewedAt)
      : activeReviewLoading
        ? 'Loading review'
        : 'Saved review';

  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (window.innerWidth >= 768) {
      return;
    }

    const touch = event.touches[0];
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    };
  }, []);

  const handleTouchEnd = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (window.innerWidth >= 768) {
      touchStartRef.current = null;
      return;
    }

    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) {
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;

    if (Math.abs(deltaX) < 64 || Math.abs(deltaX) < Math.abs(deltaY)) {
      return;
    }

    if (!mobileSidebarOpen && start.x <= 24 && deltaX > 0) {
      setMobileSidebarOpen(true);
    }

    if (mobileSidebarOpen && start.x <= 320 && deltaX < 0) {
      setMobileSidebarOpen(false);
    }
  }, [mobileSidebarOpen]);

  return (
    <div
      className="flex-1 min-h-0 overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden md:flex-row">
        <ReviewSidebar
          reviews={reviews}
          activeReviewId={activeReviewId}
          disabled={sidebarDisabled}
          mobileOpen={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
          onNewReview={handleNewReview}
          onSelectReview={handleSelectReview}
        />

        <div className="flex-1 min-h-0 overflow-hidden">
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <div className="border-b border-border/70 bg-background/95 backdrop-blur md:hidden">
              <div className="mx-auto flex w-full max-w-[52rem] items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(true)}
                  aria-label="Open reviews"
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18" />
                    <path d="M3 12h18" />
                    <path d="M3 18h18" />
                  </svg>
                </button>

                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{mobileTitle}</div>
                  <div className="truncate text-xs text-muted-foreground">{mobileSubtitle}</div>
                </div>
              </div>
            </div>

            {error && (
              <div className="mx-auto w-full max-w-[52rem] px-4 pt-4 sm:px-6 lg:px-8">
                <div className="rounded-xl border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              </div>
            )}

            <div className="app-scrollbar flex-1 min-h-0 overflow-y-auto">
              <div className="mx-auto flex h-full w-full max-w-[52rem] flex-col px-4 py-4 sm:px-6 lg:px-8">
                {showingDraft && draftPhase === 'idle' && (
                  <div className="flex flex-1 items-center justify-center py-8">
                    <div className="w-full max-w-3xl space-y-6">
                      <div className="space-y-2 text-center">
                        <h1 className="text-3xl font-semibold text-foreground">Weekly Review</h1>
                        <p className="text-sm text-muted-foreground">
                          Start a new review when you are ready, or reopen a saved plan from the sidebar.
                        </p>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={handleOpenDraftInterview}
                          className="rounded-2xl border border-primary/30 bg-primary/10 p-5 text-left transition-colors hover:border-primary/40 hover:bg-primary/12"
                        >
                          <div className="text-base font-medium text-foreground">New review</div>
                          <p className="mt-2 text-sm text-muted-foreground">
                            Open a fresh review draft and decide when to begin the interview.
                          </p>
                        </button>

                        <button
                          type="button"
                          onClick={() => recentReviews[0] && handleSelectReview(recentReviews[0].id)}
                          disabled={recentReviews.length === 0}
                          className="rounded-2xl border border-border bg-background p-5 text-left transition-colors hover:border-border/80 hover:bg-muted/30 disabled:cursor-default disabled:opacity-50"
                        >
                          <div className="text-base font-medium text-foreground">Latest saved review</div>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {recentReviews[0]
                              ? `${getReviewTitle(recentReviews[0])}, ${formatReviewDetails(
                                recentReviews[0].interviewedAt,
                              )}`
                              : reviewsLoading
                                ? 'Loading saved reviews...'
                                : 'No saved reviews yet.'}
                          </p>
                        </button>
                      </div>

                      <div className="rounded-2xl border border-border bg-background/80 p-4">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <h2 className="text-sm font-semibold text-foreground">Recent reviews</h2>
                            <p className="text-sm text-muted-foreground">
                              Pick up an earlier plan without starting a new session.
                            </p>
                          </div>
                          {recentReviews.length > 0 && (
                            <Button variant="outline" size="sm" onClick={() => handleSelectReview(recentReviews[0].id)}>
                              Open latest
                            </Button>
                          )}
                        </div>

                        <div className="mt-4 space-y-2">
                          {reviewsLoading ? (
                            <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                              Loading saved reviews...
                            </div>
                          ) : recentReviews.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                              Finalized reviews will appear here after your first save.
                            </div>
                          ) : (
                            recentReviews.map((review) => (
                              <button
                                key={review.id}
                                type="button"
                                onClick={() => handleSelectReview(review.id)}
                                className="block w-full rounded-xl border border-border px-4 py-3 text-left transition-colors hover:bg-muted/30"
                              >
                                <div className="text-sm font-medium text-foreground">{getReviewTitle(review)}</div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {formatReviewDetails(review.interviewedAt)}
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {draftPhase !== 'idle' && (
                  <div className={showingDraft && draftPhase === 'interview' ? 'flex flex-1 min-h-0 flex-col' : 'hidden'}>
                    <InterviewChat
                      onFinalize={handleFinalize}
                      finalizing={finalizing}
                      onStreamingChange={setChatStreaming}
                    />
                  </div>
                )}

                {draftPhase === 'preview' && draftPlan && (
                  <div className={showingDraft ? 'flex flex-1 min-h-0 flex-col' : 'hidden'}>
                    <PlanPreview
                      plan={draftPlan}
                      title="Weekly plan ready"
                      subtitle="Accept this plan, or go back to the interview if you want to refine it."
                      primaryActionLabel="Accept Plan"
                      onPrimaryAction={handleAccept}
                      secondaryActionLabel="Back to Chat"
                      onSecondaryAction={handleBackToInterview}
                    />
                  </div>
                )}

                {!showingDraft && (
                  activeReviewLoading ? (
                    <div className="flex flex-1 items-center justify-center">
                      <div className="rounded-2xl border border-border bg-background/80 px-4 py-3 text-sm text-muted-foreground">
                        Loading review...
                      </div>
                    </div>
                  ) : activeReview ? (
                    <PlanPreview
                      plan={activeReview.plan}
                      title={getReviewTitle(activeReview)}
                      subtitle={formatReviewDetails(activeReview.interviewedAt)}
                      notice={formatCompletionNotice(activeReview.completionSummary)}
                    />
                  ) : (
                    <div className="flex flex-1 items-center justify-center">
                      <div className="rounded-2xl border border-border bg-background/80 px-4 py-3 text-sm text-muted-foreground">
                        Select a saved review from the sidebar.
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
