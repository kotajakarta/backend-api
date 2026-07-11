import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  try {
    const data = await prisma.student.findMany({ take: 1, include: { biodata: true, wilayah: true, cabang: true, riwayatPendidikan: true } });
    console.log("SUCCESS");
  } catch(e) {
    console.error("PRISMA ERROR:", e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
