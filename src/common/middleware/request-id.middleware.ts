import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * Assigns a unique X-Request-ID to every incoming request.
 * This ID is used throughout audit logs, error logs, and response headers
 * to enable full request tracing across distributed systems.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = req.headers['x-request-id'] as string || crypto.randomUUID();
  (req as any).requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
}
