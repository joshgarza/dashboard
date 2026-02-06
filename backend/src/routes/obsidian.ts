import { Router, Request, Response, NextFunction } from 'express';
import { getCurrentWeekNote } from '../services/obsidianService.js';

const router = Router();

router.get('/obsidian/weekly-todos', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const summary = getCurrentWeekNote();
    res.json({
      success: true,
      data: summary,
    });
  } catch (err) {
    next(err);
  }
});

export { router as obsidianRouter };
