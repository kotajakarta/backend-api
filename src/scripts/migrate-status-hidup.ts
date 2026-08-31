import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  console.log('🔄 Migrating statusHidupAyah & statusHidupIbu ("Wafat" / "Deceased" -> "Sudah Meninggal")...');

  const updateAyah = await prisma.biodata.updateMany({
    where: {
      statusHidupAyah: {
        in: ['Wafat', 'wafat', 'Deceased', 'deceased', 'Meninggal', 'meninggal']
      }
    },
    data: {
      statusHidupAyah: 'Sudah Meninggal'
    }
  });

  const updateIbu = await prisma.biodata.updateMany({
    where: {
      statusHidupIbu: {
        in: ['Wafat', 'wafat', 'Deceased', 'deceased', 'Meninggal', 'meninggal']
      }
    },
    data: {
      statusHidupIbu: 'Sudah Meninggal'
    }
  });

  console.log(`✅ Updated ${updateAyah.count} biodata for Ayah to "Sudah Meninggal".`);
  console.log(`✅ Updated ${updateIbu.count} biodata for Ibu to "Sudah Meninggal".`);

  const ayahStats = await prisma.biodata.groupBy({
    by: ['statusHidupAyah'],
    _count: { _all: true }
  });
  const ibuStats = await prisma.biodata.groupBy({
    by: ['statusHidupIbu'],
    _count: { _all: true }
  });
  console.log('Current Ayah Stats:', ayahStats);
  console.log('Current Ibu Stats:', ibuStats);

  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error('❌ Error migrating status hidup:', err);
  process.exit(1);
});
