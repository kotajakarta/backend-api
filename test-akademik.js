import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const akademik = await prisma.pengaturanAkademik.findFirst();
  console.log("Akademik:", akademik);
}
main().catch(console.error).finally(() => prisma.$disconnect());
