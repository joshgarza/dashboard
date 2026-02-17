import { Router, Request, Response, NextFunction } from 'express';
import { getTodayEvents } from '../services/googleCalendarService.js';

const router = Router();

router.get('/calendar/today', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiKey = process.env.GOOGLE_CALENDAR_API_KEY;
    const calendarId = process.env.GOOGLE_CALENDAR_ID;

    if (!apiKey || !calendarId) {
      res.status(500).json({
        success: false,
        error: 'Google Calendar API key or Calendar ID not configured',
      });
      return;
    }

    const events = await getTodayEvents(apiKey, calendarId);
    res.json({
      success: true,
      data: events,
    });
  } catch (err) {
    next(err);
  }
});

export { router as calendarRouter };
