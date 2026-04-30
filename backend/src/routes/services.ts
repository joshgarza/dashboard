import { Router, Request, Response, NextFunction } from 'express';
import { getServiceStatuses } from '../services/serviceStatus.js';

const router = Router();

router.get('/services', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const services = await getServiceStatuses();
    res.json({ success: true, data: services });
  } catch (err) {
    next(err);
  }
});

export { router as servicesRouter };
