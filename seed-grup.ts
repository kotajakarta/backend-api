import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const groups = ['Endonezya', 'Isler', 'Muadalah'];
  for (const name of groups) {
    const exists = await prisma.grupDaimi.findFirst({ where: { name } });
    if (!exists) {
      await prisma.grupDaimi.create({ data: { name } });
      console.log(`Created GrupDaimi: ${name}`);
    } else {
      console.log(`GrupDaimi ${name} already exists`);
    }
  }
}
main().finally(() => prisma.$disconnect());
