import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } }
});

async function main() {
  const students = await prisma.student.findMany({
    where: {
      OR: [
        { statusPool: 'TERSEDIA' },
        {
          statusPool: 'AKTIF_CABANG',
          cabangId: { not: 'some-cabang-id' }
        }
      ]
    },
    include: { wilayah: true, cabang: true }
  });
  console.log(students.length, 'students found');
}
main().catch(console.error).finally(() => prisma.$disconnect());
