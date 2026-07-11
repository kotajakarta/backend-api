import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const staff = await prisma.staff.findFirst();
  console.log(staff);
  if (staff) {
    await prisma.staff.update({
      where: { id: staff.id },
      data: { waliKelas: null }
    });
    console.log("Update successful");
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
