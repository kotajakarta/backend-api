import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const classes = await prisma.kelas.findMany({
    include: {
      cabang: {
        include: {
          wilayah: true
        }
      }
    }
  });
  console.log(`TOTAL CLASSES IN DB: ${classes.length}`);
  classes.forEach(c => {
    console.log(`- ID: ${c.id}, Name: ${c.name}, Tingkat: ${c.tingkat}, Active: ${c.isActive}, Cabang: ${c.cabang?.name || 'N/A'}, Wilayah: ${c.cabang?.wilayah?.name || 'N/A'}`);
  });
}

main().finally(async () => {
  await prisma.$disconnect();
  await pool.end();
});
