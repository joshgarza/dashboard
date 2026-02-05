import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError.js';

interface ErrorResponse {
  success: false;
  error: {
    message: string;
    code: string;
  };
}

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(new AppError('Route not found', 404, 'NOT_FOUND'));
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof AppError) {
    const response: ErrorResponse = {
      success: false,
      error: {
        message: err.message,
        code: err.code,
      },
    };
    res.status(err.statusCode).json(response);
    return;
  }

  console.error('Unhandled error:', err);

  const response: ErrorResponse = {
    success: false,
    error: {
      message: 'An unexpected error occurred',
      code: 'INTERNAL_ERROR',
    },
  };
  res.status(500).json(response);
}
