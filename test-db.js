import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const pel = await prisma.pelanggaranSantri.findMany();
  console.log('Pelanggaran:', pel.length);
  const sp = await prisma.suratPeringatan.findMany();
  console.log('SP:', sp.length);
  const do_ = await prisma.pengeluaranSantri.findMany();
  console.log('DO:', do_.length);
}
main().catch(console.error).finally(() => prisma.$disconnect());
