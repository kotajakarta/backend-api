import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ log: ['query'] });

async function main() {
  const user = {
    scope: 'CABANG',
    cabangId: '633b3833-afb7-4a10-9627-cd9b0cfbed53',
    wilayahId: 'd15a25fa-b336-436d-b2fc-e915d183f8b5'
  };
  const { scope, wilayahId, cabangId } = user;
  let whereClause: any = {
    OR: [
      { statusPool: 'TERSEDIA' },
      ...(scope === 'CABANG' && cabangId ? [{
        statusPool: 'AKTIF_CABANG',
        cabangId: { not: cabangId }
      }] : [])
    ]
  };

  const students = await prisma.student.findMany({ where: whereClause, take: 5 });
  console.log('Got', students.length);
}
main().catch(console.error).finally(() => prisma.$disconnect());
