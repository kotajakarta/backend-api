const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const result = await prisma.grupDaimi.findMany();
  console.log('GrupDaimi:', result);
}
main().catch(console.error).finally(() => prisma.$disconnect());
