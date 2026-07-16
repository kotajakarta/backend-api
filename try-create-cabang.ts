import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.$transaction(async (tx) => {
    try {
      console.log("Trying tx.cabang.create...");
      const c = await tx.cabang.create({
        data: {
          name: 'TEST_CABANG_XYZ',
          wilayahId: null
        }
      });
      console.log("SUCCESS:", c);
      // rollback
      throw new Error("Force rollback");
    } catch (err: any) {
      console.error("ERROR:");
      console.error(err);
      throw err;
    }
  });
}

main().catch(() => {}).finally(async () => {
  await prisma.$disconnect();
  await pool.end();
});
