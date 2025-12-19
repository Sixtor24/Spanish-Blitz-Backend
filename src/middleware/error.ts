/**
 * Error handling middleware and utilities
 */
import type { Request, Response, NextFunction } from 'express';

export class ApiError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(statusCode: number, message: string, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: Error | ApiError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: err.message,
      status: err.statusCode,
    });
  }

  // Log unexpected errors
  console.error('Unexpected error:', err);

  return res.status(500).json({
    error: 'Internal server error',
    status: 500,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

/**
 * Async handler wrapper to catch errors in async route handlers
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Wrapper for route handlers with error handling and context
 */
export const withErrorHandler = <T = any>(
  handler: (req: Request, res: Response) => Promise<Response | void>,
  context?: string
) => {
  return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    try {
      return await handler(req, res);
    } catch (error: any) {
      console.error(`Error in ${context || 'route'}:`, error);
      
      if (error instanceof ApiError) {
        throw error;
      }
      
      throw new ApiError(
        error.statusCode || 500,
        error.message || 'Internal server error'
      );
    }
  });
};

