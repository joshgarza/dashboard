import { Router, Request, Response, NextFunction } from 'express';
import { completeTodo, uncompleteTodo, listAllTodos } from '../services/todoService.js';

const router = Router();

router.get('/todos', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const todos = listAllTodos();
    res.json({ success: true, data: todos });
  } catch (err) {
    next(err);
  }
});

router.post('/todos/:thoughtId/complete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const thoughtIdParam = req.params.thoughtId as string;
    const thoughtId = parseInt(thoughtIdParam, 10);
    if (isNaN(thoughtId)) {
      res.status(400).json({ success: false, error: 'Invalid thought ID' });
      return;
    }

    const source = req.body?.source === 'agent' ? 'agent' : 'manual';
    const found = completeTodo(thoughtId, source);
    if (!found) {
      res.status(404).json({ success: false, error: 'Todo not found' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/todos/:thoughtId/uncomplete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const thoughtIdParam = req.params.thoughtId as string;
    const thoughtId = parseInt(thoughtIdParam, 10);
    if (isNaN(thoughtId)) {
      res.status(400).json({ success: false, error: 'Invalid thought ID' });
      return;
    }

    uncompleteTodo(thoughtId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export { router as todosRouter };
