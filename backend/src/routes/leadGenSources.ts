import { Router } from 'express';
import { getAllSources, createSource, updateSource, deleteSource, reorderSources } from '../services/leadGenSourcesService.js';
import { AppError } from '../utils/AppError.js';

const router = Router();

router.get('/lead-gen-sources', (_req, res) => {
  const sources = getAllSources();
  res.json({ success: true, data: sources });
});

router.post('/lead-gen-sources', (req, res, next) => {
  const { name, url } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return next(new AppError('name is required', 400, 'VALIDATION_ERROR'));
  }
  const source = createSource(name.trim(), url?.trim() || null);
  res.status(201).json({ success: true, data: source });
});

router.put('/lead-gen-sources/:id', (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return next(new AppError('Invalid id', 400, 'VALIDATION_ERROR'));
  }
  const { name, url } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return next(new AppError('name is required', 400, 'VALIDATION_ERROR'));
  }
  const source = updateSource(id, name.trim(), url?.trim() || null);
  if (!source) {
    return next(new AppError('Source not found', 404, 'NOT_FOUND'));
  }
  res.json({ success: true, data: source });
});

router.put('/lead-gen-sources/reorder', (req, res, next) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'number')) {
    return next(new AppError('ids must be an array of numbers', 400, 'VALIDATION_ERROR'));
  }
  reorderSources(ids);
  res.json({ success: true });
});

router.delete('/lead-gen-sources/:id', (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return next(new AppError('Invalid id', 400, 'VALIDATION_ERROR'));
  }
  const deleted = deleteSource(id);
  if (!deleted) {
    return next(new AppError('Source not found', 404, 'NOT_FOUND'));
  }
  res.json({ success: true });
});

export { router as leadGenSourcesRouter };
