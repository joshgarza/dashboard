import { Router, Request, Response, NextFunction } from 'express';
import {
  getInterviewStatus,
  getTodayPlan,
  getWeeklyGoals,
  toggleTask,
  streamInterview,
  generatePlan,
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

    // Get today's date string
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const task = toggleTask(dateStr, index);
    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
});

router.post('/weekly-review/interview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages)) {
      res.status(400).json({ success: false, error: 'messages array is required' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    await streamInterview(messages, res);
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
  } catch (err) {
    next(err);
  }
});

export { router as weeklyReviewRouter };
