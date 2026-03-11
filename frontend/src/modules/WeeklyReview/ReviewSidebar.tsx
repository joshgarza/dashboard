import type { WeeklyReviewSummary } from './types';

interface ReviewSidebarProps {
  reviews: WeeklyReviewSummary[];
  activeReviewId: number | null;
  disabled: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onNewReview: () => void;
  onSelectReview: (reviewId: number) => void;
}

function formatReviewTimestamp(interviewedAt: string): string {
  const reviewedAt = new Date(interviewedAt);
  const now = new Date();
  const sameDay = reviewedAt.toDateString() === now.toDateString();

  if (sameDay) {
    return reviewedAt.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  if (reviewedAt.getFullYear() === now.getFullYear()) {
    return reviewedAt.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
    });
  }

  return reviewedAt.toLocaleDateString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getReviewTitle(review: WeeklyReviewSummary): string {
  return review.weeklyGoals[0] ?? `Weekly review ${review.week}`;
}

function SidebarContent({
  reviews,
  activeReviewId,
  disabled,
  onNewReview,
  onSelectReview,
}: Omit<ReviewSidebarProps, 'mobileOpen' | 'onCloseMobile'>) {
  return (
    <div className="flex h-full max-h-full min-h-0 flex-col">
      <div className="p-3">
        <button
          type="button"
          onClick={onNewReview}
          disabled={disabled}
          aria-pressed={activeReviewId === null}
          className={
            activeReviewId === null
              ? 'flex w-full cursor-pointer items-center justify-between rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/12 disabled:opacity-50'
              : 'flex w-full cursor-pointer items-center justify-between rounded-xl border border-border bg-background px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:border-border/80 hover:bg-background/80 disabled:opacity-50'
          }
        >
          <span>New review</span>
          <span className="text-xs text-muted-foreground">Draft</span>
        </button>
      </div>

      <div className="px-3 pb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        Saved reviews
      </div>

      <div className="app-scrollbar flex-1 min-h-0 space-y-1 overflow-y-auto px-2 pb-3">
        {reviews.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-background/60 px-3 py-4 text-sm text-muted-foreground">
            Saved weekly reviews will show up here after you finalize your first one.
          </div>
        ) : (
          reviews.map((review) => {
            const active = review.id === activeReviewId;

            return (
              <button
                key={review.id}
                type="button"
                onClick={() => onSelectReview(review.id)}
                disabled={disabled}
                aria-pressed={active}
                className={
                  active
                    ? 'block w-full cursor-pointer rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-left disabled:opacity-50'
                    : 'block w-full cursor-pointer rounded-xl border border-transparent px-3 py-2 text-left transition-colors hover:border-border hover:bg-background/80 disabled:opacity-50'
                }
              >
                <div className="truncate text-sm font-medium text-foreground">{getReviewTitle(review)}</div>
                <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>{review.taskCount} planned tasks</span>
                  <span>{formatReviewTimestamp(review.interviewedAt)}</span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export function ReviewSidebar({
  reviews,
  activeReviewId,
  disabled,
  mobileOpen,
  onCloseMobile,
  onNewReview,
  onSelectReview,
}: ReviewSidebarProps) {
  return (
    <>
      <aside className="hidden border-r border-border bg-muted/20 md:sticky md:top-0 md:flex md:h-full md:w-80 md:min-w-80 md:self-start md:flex-col">
        <SidebarContent
          reviews={reviews}
          activeReviewId={activeReviewId}
          disabled={disabled}
          onNewReview={onNewReview}
          onSelectReview={onSelectReview}
        />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close reviews"
            className="absolute inset-0 bg-background/70 backdrop-blur-sm transition-opacity"
          />

          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Weekly reviews"
            className="absolute inset-y-0 left-0 flex w-[19rem] max-w-[86vw] translate-x-0 flex-col border-r border-border bg-background shadow-xl transition-transform"
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-3">
              <div>
                <div className="text-sm font-medium text-foreground">Weekly reviews</div>
                <div className="text-xs text-muted-foreground">Swipe left or tap outside to close</div>
              </div>

              <button
                type="button"
                onClick={onCloseMobile}
                aria-label="Close sidebar"
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>

            <SidebarContent
              reviews={reviews}
              activeReviewId={activeReviewId}
              disabled={disabled}
              onNewReview={onNewReview}
              onSelectReview={onSelectReview}
            />
          </aside>
        </div>
      )}
    </>
  );
}
