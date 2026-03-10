import { Router, Request, Response, NextFunction } from 'express';
import {
  listResearchFiles,
  getQueue,
  enqueueTopic,
  streamChatMessage,
} from '../services/researchService.js';

const router = Router();

router.get('/research/files', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const files = listResearchFiles();
    res.json({ success: true, data: files });
  } catch (err) {
    next(err);
  }
});

router.get('/research/queue', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const queue = getQueue();
    res.json({ success: true, data: queue });
  } catch (err) {
    next(err);
  }
});

router.post('/research/queue', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { topic } = req.body;
    if (!topic || typeof topic !== 'string') {
      res.status(400).json({ success: false, error: 'topic is required' });
      return;
    }
    const item = enqueueTopic(req.body);
    res.json({ success: true, data: item });
  } catch (err) {
    next(err);
  }
});

router.post('/research/chat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message, messages, files, sessionId } = req.body;
    if (!message || typeof message !== 'string') {
      res.status(400).json({ success: false, error: 'message is required' });
      return;
    }

    await streamChatMessage(
      message,
      Array.isArray(messages) ? messages : [],
      Array.isArray(files) ? files : [],
      typeof sessionId === 'string' ? sessionId : null,
      res,
    );
  } catch (err) {
    if (res.headersSent) {
      console.error('Chat stream error:', err);
      return;
    }
    next(err);
  }
});

export { router as researchRouter };
