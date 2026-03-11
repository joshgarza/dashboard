import { Router, Request, Response, NextFunction } from 'express';
import {
  getInterviewStatus,
  getTodayPlan,
  getWeeklyGoals,
  getTodayDateString,
  getPlanForDate,
  getWeeklyGoalsForDate,
  listSavedReviews,
  getSavedReview,
  toggleTask,
  streamInterview,
  generatePlan,
  updateProfileAfterReview,
} from '../services/weeklyReviewService.js';

const router = Router();

router.get('/weekly-review/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const status = getInterviewStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    next(err);
  }
});

router.get('/weekly-review/today', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const plan = getTodayPlan();
    const goals = getWeeklyGoals();
    res.json({ success: true, data: { plan, goals } });
  } catch (err) {
    next(err);
  }
});

router.post('/weekly-review/today/:index/toggle', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const index = parseInt(req.params.index as string, 10);
    if (isNaN(index)) {
      res.status(400).json({ success: false, error: 'Invalid task index' });
      return;
    }

    const task = toggleTask(getTodayDateString(), index);
    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
});

router.get('/weekly-review/day/:date', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const date = req.params.date as string;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' });
      return;
    }
    const plan = getPlanForDate(date);
    const goals = getWeeklyGoalsForDate(date);
    const today = getTodayDateString();
    res.json({ success: true, data: { plan, goals, today } });
  } catch (err) {
    next(err);
  }
});

router.post('/weekly-review/day/:date/:index/toggle', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const date = req.params.date as string;
    const indexStr = req.params.index as string;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' });
      return;
    }
    const index = parseInt(indexStr, 10);
    if (isNaN(index)) {
      res.status(400).json({ success: false, error: 'Invalid task index' });
      return;
    }
    const task = toggleTask(date, index);
    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
});

router.get('/weekly-review/reviews', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const reviews = listSavedReviews();
    res.json({ success: true, data: reviews });
  } catch (err) {
    next(err);
  }
});

router.get('/weekly-review/reviews/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const reviewId = parseInt(req.params.id as string, 10);
    if (isNaN(reviewId)) {
      res.status(400).json({ success: false, error: 'Invalid review id' });
      return;
    }

    const review = getSavedReview(reviewId);
    if (!review) {
      res.status(404).json({ success: false, error: 'Review not found' });
      return;
    }

    res.json({ success: true, data: review });
  } catch (err) {
    next(err);
  }
});

router.post('/weekly-review/interview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { messages, sessionId } = req.body;
    if (!Array.isArray(messages)) {
      res.status(400).json({ success: false, error: 'messages array is required' });
      return;
    }

    await streamInterview(messages, typeof sessionId === 'string' ? sessionId : null, res);
  } catch (err) {
    if (res.headersSent) {
      console.error('Interview stream error:', err);
      return;
    }
    next(err);
  }
});

router.post('/weekly-review/finalize', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages)) {
      res.status(400).json({ success: false, error: 'messages array is required' });
      return;
    }

    const plan = await generatePlan(messages);
    res.json({ success: true, data: plan });
    // Fire-and-forget: update learning profile in background
    updateProfileAfterReview(messages, plan.plan);
  } catch (err) {
    next(err);
  }
});

export { router as weeklyReviewRouter };
