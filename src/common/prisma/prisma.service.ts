import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Columns that hold base64 images (hundreds of KB per row) and are left out of
 * every query by default. staff/cabang are included by dozens of queries —
 * including the auth guard on every request and list endpoints polled by the
 * UI — and each one was dragging these photos along. A query that really
 * needs them opts back in with `omit: { <field>: false }`.
 */
export const HEAVY_COLUMNS_OMIT = {
  staff: { ktpUrl: true, ijazahUrl: true, ifadahUrl: true },
  cabang: {
    fotoPlang: true,
    fotoGedung: true,
    fotoHalaman: true,
    fotoDenah: true,
    fotoMushala: true,
    fotoKelas: true,
    fotoRuangTidur: true,
    fotoRuangMakan: true,
    fotoKamarMandi: true,
  },
} as const;

export const STAFF_DOCUMENTS_OPT_IN = { ktpUrl: false, ijazahUrl: false, ifadahUrl: false } as const;
export const CABANG_PHOTOS_OPT_IN = {
  fotoPlang: false,
  fotoGedung: false,
  fotoHalaman: false,
  fotoDenah: false,
  fotoMushala: false,
  fotoKelas: false,
  fotoRuangTidur: false,
  fotoRuangMakan: false,
  fotoKamarMandi: false,
} as const;

type ClientOptions = {
  adapter: PrismaPg;
  log: Prisma.LogLevel[];
  omit: typeof HEAVY_COLUMNS_OMIT;
};

@Injectable()
export class PrismaService extends PrismaClient<ClientOptions> implements OnModuleInit, OnModuleDestroy {
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
    const log: Prisma.LogLevel[] = process.env.NODE_ENV === 'production' ? [] : ['query'];
    super({ adapter, log, omit: HEAVY_COLUMNS_OMIT });
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
