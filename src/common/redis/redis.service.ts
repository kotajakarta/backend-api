import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor() {
    const redisUri = process.env.REDIS_URI || process.env.REDIS_URL || 'redis://localhost:6379';
    this.logger.log(`Menghubungkan ke Redis: ${redisUri.replace(/:[^@]+@/, ':****@')}`);
    
    this.client = new Redis(redisUri, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
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
