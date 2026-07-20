import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor() {
    let redisUri = process.env.REDIS_URI || process.env.REDIS_URL || 'redis://localhost:6379';
    // Clean up any surrounding quotes added by container env loaders
    redisUri = redisUri.trim().replace(/^['"]|['"]$/g, '');

    // Correct protocol prefix if it got malformed (e.g. starts with //)
    if (redisUri.startsWith('//')) {
      redisUri = 'redis:' + redisUri;
    }

    this.logger.log(`Menghubungkan ke Redis: ${redisUri.replace(/:[^@]+@/, ':****@')}`);
    
    this.client = new Redis(redisUri, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false, // Fail commands instantly when connection is offline to trigger fallback
      connectTimeout: 2000, // 2 seconds connect timeout
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 1000, 15000);
        return delay;
      }
    });

    this.client.on('connect', () => {
      this.logger.log('Berhasil terhubung ke Redis server');
    });

    this.client.on('error', (err: Error) => {
      this.logger.error('Koneksi Redis error:', err);
    });
  }

  // Get raw client
  getClient(): Redis {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.expire(key, ttlSeconds);
    return result === 1;
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async onModuleDestroy() {
    this.logger.log('Memutuskan koneksi dari Redis...');
    await this.client.quit();
  }
}
