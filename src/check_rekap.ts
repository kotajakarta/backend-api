import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const rows = await prisma.rekapPembelajaran.findMany({
    where: { unitName: { contains: 'DOGU CAVA' } }
  });
  console.log('Found rows count:', rows.length);
  for (const row of rows) {
    console.log('--- Row:', row.unitName, row.periodeKey, row.unitLevel, 'updatedAt:', row.updatedAt);
    const json = row.weeksJson as any;
    if (json && json.weeks) {
      console.log('  Number of weeks:', json.weeks.length);
      const w0 = json.weeks[0];
      console.log('  Week 0 dateLabel:', w0?.dateLabel);
      console.log('  Week 0 cabangHolidays length:', w0?.cabangHolidays?.length);
      console.log('  Week 0 details count:', w0?.details?.length);
      if (w0?.details?.length > 0) {
        console.log('  Sample detail:', JSON.stringify(w0.details[0], null, 2));
      }
    }
  }
}

main().catch(console.error).finally(() => {
  prisma.$disconnect();
  pool.end();
});
