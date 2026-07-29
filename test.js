import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const wilayahs = await prisma.wilayah.findMany({ take: 10 });
  console.log(wilayahs);
}
main().catch(console.error).finally(() => prisma.$disconnect());
