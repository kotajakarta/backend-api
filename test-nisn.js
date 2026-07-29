import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const emptyNisn = await prisma.siswaFormal.count({ where: { nisn: "" } });
  console.log("SiswaFormal empty nisn:", emptyNisn);
}
main().catch(console.error).finally(() => prisma.$disconnect());
