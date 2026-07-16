import { Request, Response, NextFunction } from 'express';

/**
 * Enterprise-grade in-memory rate limiter.
 * Tracks request counts per IP within sliding time windows.
 * No external dependencies (Redis-free).
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 60 seconds to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.resetTime) {
      store.delete(key);
    }
  }
}, 60_000);

function createRateLimiter(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Membaca IP asli dari header proxy (Cloudflare/Cloudflared) atau fallback ke IP socket
    const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${ip}:${req.path}`;
    const now = Date.now();

    const entry = store.get(key);

    if (!entry || now > entry.resetTime) {
      store.set(key, { count: 1, resetTime: now + windowMs });
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', maxRequests - 1);
      return next();
    }

    if (entry.count >= maxRequests) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', 0);
      return res.status(429).json({
        statusCode: 429,
        message: 'Too many requests. Please try again later.',
        retryAfterSeconds: retryAfter,
      });
    }

    entry.count++;
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', maxRequests - entry.count);
    next();
  };
}

/** Strict rate limiter for authentication endpoints: 5 attempts per 60 seconds */
export const loginRateLimiter = createRateLimiter(5, 60_000);

/** General rate limiter for all API endpoints: 100 requests per 60 seconds */
export const globalRateLimiter = createRateLimiter(100, 60_000);
