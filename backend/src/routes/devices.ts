import { Router } from 'express';
import {
  getAllDevices,
  getDeviceById,
  createDevice,
  deleteDevice,
  resetRegistry,
} from '../services/deviceRegistry.js';
import { AppError } from '../utils/AppError.js';

const router = Router();

router.get('/devices', (_req, res) => {
  const devices = getAllDevices();
  res.json({ success: true, data: devices });
});

router.get('/devices/:id', (req, res, next) => {
  const device = getDeviceById(req.params.id);

  if (!device) {
    return next(new AppError('Device not found', 404, 'NOT_FOUND'));
  }

  res.json({ success: true, data: device });
});

router.post('/devices', (req, res, next) => {
  const { name, host, port, type } = req.body;

  if (!name || !host || !port || !type) {
    return next(new AppError('Missing required fields: name, host, port, type', 400, 'VALIDATION_ERROR'));
  }

  const device = createDevice({ name, host, port, type });
  res.status(201).json({ success: true, data: device });
});

router.delete('/devices/:id', (req, res, next) => {
  const deleted = deleteDevice(req.params.id);

  if (!deleted) {
    return next(new AppError('Device not found', 404, 'NOT_FOUND'));
  }

  res.json({ success: true, message: 'Device deleted' });
});

router.get('/devices/:id/stats', async (req, res, next) => {
  const device = getDeviceById(req.params.id);

  if (!device) {
    return next(new AppError('Device not found', 404, 'NOT_FOUND'));
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`http://${device.host}:${device.port}/api/stats`, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error('Failed to fetch stats from device');
    }

    const stats = await response.json();
    res.json({ success: true, data: stats });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return next(new AppError('Device timeout', 504, 'DEVICE_TIMEOUT'));
    }
    return next(new AppError('Device offline or unreachable', 503, 'DEVICE_OFFLINE'));
  }
});

export { router as devicesRouter, resetRegistry };
