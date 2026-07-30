import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  let createdIds = [];
  try {
    const biodata1 = await prisma.biodata.create({
      data: {
        nik: "TEST_DUP",
        fullName: "Test 1"
      }
    });
    createdIds.push(biodata1.id);
    const biodata2 = await prisma.biodata.create({
      data: {
        nik: "TEST_DUP",
        fullName: "Test 2"
      }
    });
    createdIds.push(biodata2.id);
  } catch(e) {
    console.log("META_TARGET:", e.meta.target);
  } finally {
    await prisma.biodata.deleteMany({ where: { id: { in: createdIds } }});
    await prisma.$disconnect();
  }
}

main();
