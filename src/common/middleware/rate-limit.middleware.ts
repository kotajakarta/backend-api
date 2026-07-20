import { Request, Response, NextFunction } from 'express';
import { Redis } from 'ioredis';

/**
 * Enterprise-grade Redis-backed sliding window rate limiter.
 * Fallbacks automatically to in-memory store if Redis is unavailable.
 */

let redisClient: Redis | null = null;

export function setRateLimitRedisClient(client: Redis) {
  redisClient = client;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const memoryStore = new Map<string, RateLimitEntry>();

// Clean up expired local memory entries to prevent leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryStore.entries()) {
    if (now > entry.resetTime) {
      memoryStore.delete(key);
    }
  }
}, 60_000);

function fallbackLimiter(req: Request, res: Response, next: NextFunction, key: string, maxRequests: number, windowMs: number) {
  const now = Date.now();
  const entry = memoryStore.get(key);

  if (!entry || now > entry.resetTime) {
    memoryStore.set(key, { count: 1, resetTime: now + windowMs });
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
}

function createRateLimiter(maxRequests: number, windowMs: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Membaca IP asli dari header proxy (Cloudflare/Cloudflared) atau fallback ke IP socket
    const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress || 'unknown';
    const key = `ratelimit:${ip}:${req.path}`;
    const windowSec = Math.ceil(windowMs / 1000);

    if (!redisClient) {
      return fallbackLimiter(req, res, next, key, maxRequests, windowMs);
    }

    try {
      // atomic INCR and TTL fetch using multi
      const multi = redisClient.multi();
      multi.incr(key);
      multi.ttl(key);
      
      const results = await multi.exec();
      if (!results || results.length < 2) {
        return fallbackLimiter(req, res, next, key, maxRequests, windowMs);
      }

      // results[0] = [err, count], results[1] = [err, ttl]
      const count = results[0][1] as number;
      let ttl = results[1][1] as number;

      // If key is new or doesn't have an expiry set, set the TTL
      if (count === 1 || ttl === -1) {
        await redisClient.expire(key, windowSec);
        ttl = windowSec;
      }

      const remaining = Math.max(0, maxRequests - count);
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', remaining);

      if (count > maxRequests) {
        const retryAfter = ttl > 0 ? ttl : windowSec;
        res.setHeader('Retry-After', retryAfter);
        res.setHeader('X-RateLimit-Remaining', 0);
        return res.status(429).json({
          statusCode: 429,
          message: 'Too many requests. Please try again later.',
          retryAfterSeconds: retryAfter,
        });
      }

      next();
    } catch (err) {
      // Fallback to local memory on connection failure
      fallbackLimiter(req, res, next, key, maxRequests, windowMs);
    }
  };
}

/** Strict rate limiter for authentication endpoints: 5 attempts per 60 seconds */
export const loginRateLimiter = createRateLimiter(5, 60_000);

/** Rate limiter for student public registration / re-registration: 10 attempts per 60 seconds */
export const daftarUlangRateLimiter = createRateLimiter(10, 60_000);

/** General rate limiter for all API endpoints: 100 requests per 60 seconds */
export const globalRateLimiter = createRateLimiter(100, 60_000);
