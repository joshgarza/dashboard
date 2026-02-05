import { Router } from 'express';
import { getSystemStats } from '../services/systemStats.js';

const router = Router();

router.get('/stats', (_req, res) => {
  const stats = getSystemStats();
  res.json(stats);
});

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

export default router;
