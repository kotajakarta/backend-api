import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const c = await prisma.student.groupBy({ by: ['statusPool'], _count: true });
  console.log(c);
}
main();
