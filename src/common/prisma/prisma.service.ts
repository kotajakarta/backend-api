import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    // In cluster mode (see main.ts CLUSTER_WORKERS) each worker process gets its
    // own pool, so the effective total is workers × max — keep this configurable
    // so it can be scaled down to stay under Postgres' max_connections.
    const poolMax = process.env.DATABASE_POOL_MAX ? parseInt(process.env.DATABASE_POOL_MAX, 10) : undefined;
    // Default idleTimeoutMillis (10s) with min:0 makes the pool drop to zero
    // connections during any quiet gap, so the next request pays a fresh
    // connect+auth round trip to Postgres. Under real usage (bursts every
    // 10-30s) this was observed constantly reconnecting instead of reusing
    // connections — keep a couple warm per worker and let them sit idle longer.
    const pool = new Pool({
      connectionString,
      ...(poolMax ? { max: poolMax } : {}),
      min: 2,
      idleTimeoutMillis: 60_000,
    });
    const adapter = new PrismaPg(pool);
    super({ adapter, log: process.env.NODE_ENV === 'production' ? [] : ['query'] });
  }
  async onModuleInit() {
    await this.$connect();
    console.log('✅ Prisma connected to database');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    console.log('🔌 Prisma disconnected from database');
  }
}
