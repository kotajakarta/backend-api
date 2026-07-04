import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } }
  });

  const scope = 'CABANG';
  const cabangId = '633b3833-afb7-4a10-9627-cd9b0cfbed53';
  const wilayahId = 'd15a25fa-b336-436d-b2fc-e915d183f8b5';

  let whereClause: any = {
    OR: [
      { statusPool: 'TERSEDIA' },
      ...(scope === 'CABANG' && cabangId ? [{
        statusPool: 'AKTIF_CABANG',
        cabangId: { not: cabangId }
      }] : [])
    ]
  };

  const students = await prisma.student.findMany({
    where: whereClause,
    select: { id: true, statusPool: true, wilayahId: true, cabangId: true }
  });

  console.log('Total returned:', students.length);
  const wilayahs = new Set(students.map(s => s.wilayahId));
  console.log('Unique Wilayahs:', [...wilayahs].length);
}
main().catch(console.error);
