import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://aithendi:Hendi_2026%3F%3F@100.106.18.101:5432/edaimi"
    }
  }
});

async function main() {
  const allAbsensi = await prisma.absensiMapel.findMany({
    orderBy: { createdAt: 'desc' }
  });

  const seen = new Set();
  const toDelete = [];

  for (const a of allAbsensi) {
    const key = `${a.mataPelajaranId}_${a.kelasId}_${a.studentId}_${a.tanggal.toISOString()}`;
    if (seen.has(key)) {
      toDelete.push(a.id);
    } else {
      seen.add(key);
    }
  }

  if (toDelete.length > 0) {
    console.log(`Deleting ${toDelete.length} duplicate records...`);
    await prisma.absensiMapel.deleteMany({
      where: { id: { in: toDelete } }
    });
    console.log('Done.');
  } else {
    console.log('No duplicates found.');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
