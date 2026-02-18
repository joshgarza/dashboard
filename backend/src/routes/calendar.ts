import { Router, Request, Response, NextFunction } from 'express';
import { getTodayEvents } from '../services/googleCalendarService.js';

const router = Router();

router.get('/calendar/today', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiKey = process.env.GOOGLE_CALENDAR_API_KEY;
    const calendarIdStr = process.env.GOOGLE_CALENDAR_ID;

    if (!apiKey || !calendarIdStr) {
      res.status(500).json({
        success: false,
        error: 'Google Calendar API key or Calendar ID not configured',
      });
      return;
    }

    const calendarIds = calendarIdStr.split(',').map(id => id.trim()).filter(Boolean);
    const result = await getTodayEvents(apiKey, calendarIds);
    res.json({
      success: true,
      data: result.events,
      currentHour: result.currentHour,
    });
  } catch (err) {
    next(err);
  }
});

export { router as calendarRouter };
