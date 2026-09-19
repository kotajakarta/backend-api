import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const pel = await prisma.pelanggaranSantri.findMany();
  console.log('Total Pelanggaran:', pel.length, pel);
}
main().catch(console.error).finally(() => prisma.$disconnect());
