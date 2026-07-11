import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function test() {
  const user = { scope: 'GLOBAL' }; // Adjust if needed
  let whereClause = {};

  try {
    console.log("Testing student.count...");
    await prisma.student.count({
      where: user.scope === 'GLOBAL' ? {} : whereClause
    });

    console.log("Testing student.groupBy...");
    await prisma.student.groupBy({
      by: ['grupDaimi'],
      _count: { id: true },
      where: user.scope === 'GLOBAL' ? { isActive: true } : { ...whereClause, isActive: true }
    });

    console.log("Testing nonMuadalahCount...");
    await prisma.student.count({
      where: user.scope === 'GLOBAL' 
        ? { isActive: true, OR: [{ jenisSiswa: { not: 'MUADALAH' } }, { jenisSiswa: null }] } 
        : { ...whereClause, isActive: true, OR: [{ jenisSiswa: { not: 'MUADALAH' } }, { jenisSiswa: null }] }
    });

    console.log("Testing siswaFormal.findMany...");
    await prisma.siswaFormal.findMany({
      where: user.scope === 'GLOBAL' ? { student: { isActive: true } } : { student: { ...whereClause, isActive: true } },
      include: { kelas: true }
    });

    console.log("Testing kelas.count...");
    await prisma.kelas.count({
      where: user.scope === 'GLOBAL' ? {} : { cabang: whereClause }
    });

    console.log("Testing cabang.findMany...");
    await prisma.cabang.findMany({
      where: user.scope === 'GLOBAL' ? {} : whereClause,
      include: {
        staff: {
          where: { statusPool: 'AKTIF_CABANG' }
        }
      }
    });

    console.log("Testing auditLog.findMany...");
    await prisma.auditLog.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      where: user.scope === 'GLOBAL' 
        ? {} 
        : user.scope === 'WILAYAH' 
          ? { wilayahId: user.wilayahId as string }
          : { cabangId: user.cabangId as string }
    });

    console.log("All queries successful!");
  } catch (error) {
    console.error("Query failed:", error);
  } finally {
    await prisma.$disconnect();
  }
}

test();
