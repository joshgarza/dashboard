import { Router, Request, Response, NextFunction } from 'express';
import {
  listResearchFiles,
  loadFileContent,
  getQueue,
  enqueueTopic,
  streamChat,
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
    const { files, messages } = req.body;
    if (!Array.isArray(files) || !Array.isArray(messages)) {
      res.status(400).json({ success: false, error: 'files and messages arrays are required' });
      return;
    }

    // Load file contents
    const fileContents = files.map((key: string) => ({
      key,
      content: loadFileContent(key),
    }));

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    await streamChat(fileContents, messages, res);
  } catch (err) {
    // If headers already sent (SSE streaming started), we can't use error middleware
    if (res.headersSent) {
      console.error('Chat stream error:', err);
      return;
    }
    next(err);
  }
});

export { router as researchRouter };
