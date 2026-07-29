import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const allSiswa = await prisma.siswaFormal.findMany({ select: { nisn: true, studentId: true } });
  const counts = {};
  for (const s of allSiswa) {
    if (s.nisn) {
      counts[s.nisn] = (counts[s.nisn] || 0) + 1;
    }
  }
  const dups = Object.entries(counts).filter(([k,v]) => v > 1);
  console.log("Duplicates in SiswaFormal NISN:", dups);

  const allBiodata = await prisma.biodata.findMany({ select: { nisn: true } });
  const bioCounts = {};
  for (const b of allBiodata) {
    if (b.nisn) {
      bioCounts[b.nisn] = (bioCounts[b.nisn] || 0) + 1;
    }
  }
  const bioDups = Object.entries(bioCounts).filter(([k,v]) => v > 1);
  console.log("Duplicates in Biodata NISN (Top 10):", bioDups.slice(0, 10));
}
main().catch(console.error).finally(() => prisma.$disconnect());
