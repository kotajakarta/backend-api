import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PembelajaranService } from './src/modules/pembelajaran/pembelajaran.service.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const service = new PembelajaranService(prisma as any);
  const result = await service.getRingkasan({ scope: 'GLOBAL' });
  console.log(JSON.stringify(result, null, 2));
}

main().finally(() => prisma.$disconnect());
