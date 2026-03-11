import { Router, Request, Response, NextFunction } from 'express';
import {
  listResearchFiles,
  getQueue,
  enqueueTopic,
  getResearchChat,
  listResearchChats,
  streamPersistedChatMessage,
  updateResearchChatFiles,
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

router.get('/research/chats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const chats = listResearchChats();
    res.json({ success: true, data: chats });
  } catch (err) {
    next(err);
  }
});

router.get('/research/chats/:chatId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const chatId = Array.isArray(req.params.chatId) ? req.params.chatId[0] : req.params.chatId;
    const chat = getResearchChat(chatId);
    if (!chat) {
      res.status(404).json({ success: false, error: 'research chat not found' });
      return;
    }

    res.json({ success: true, data: chat });
  } catch (err) {
    next(err);
  }
});

router.patch('/research/chats/:chatId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const chatId = Array.isArray(req.params.chatId) ? req.params.chatId[0] : req.params.chatId;
    const { selectedFiles } = req.body;
    if (!Array.isArray(selectedFiles) || selectedFiles.some((file) => typeof file !== 'string')) {
      res.status(400).json({ success: false, error: 'selectedFiles must be an array of strings' });
      return;
    }

    const chat = updateResearchChatFiles(chatId, selectedFiles);
    if (!chat) {
      res.status(404).json({ success: false, error: 'research chat not found' });
      return;
    }

    res.json({ success: true, data: chat });
  } catch (err) {
    if (err instanceof Error && err.message === 'Invalid file key') {
      res.status(400).json({ success: false, error: err.message });
      return;
    }
    next(err);
  }
});

router.post('/research/chat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message, chatId, files } = req.body;
    if (!message || typeof message !== 'string') {
      res.status(400).json({ success: false, error: 'message is required' });
      return;
    }

    await streamPersistedChatMessage(
      message,
      typeof chatId === 'string' ? chatId : null,
      Array.isArray(files) ? files : [],
      res,
    );
  } catch (err) {
    if (err instanceof Error && err.message === 'Research chat not found') {
      res.status(404).json({ success: false, error: err.message });
      return;
    }
    if (err instanceof Error && err.message === 'Invalid file key') {
      res.status(400).json({ success: false, error: err.message });
      return;
    }
    if (res.headersSent) {
      console.error('Chat stream error:', err);
      return;
    }
    next(err);
  }
});

export { router as researchRouter };
