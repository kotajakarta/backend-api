import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { normalizeTurkish } from '../common/utils/turkish-char.util.js';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  console.log('🔄 Checking & normalizing Turkish characters in PostgreSQL...');

  const allBiodatas = await prisma.biodata.findMany({
    select: {
      id: true,
      fullName: true,
      tempatLahir: true,
      namaAyah: true,
      namaIbu: true,
      address: true,
      alamatJalan: true,
      alamatProvName: true,
      alamatKabName: true,
      alamatKecName: true,
      alamatKelName: true,
      kontakDaruratNama: true,
    }
  });

  console.log(`Found ${allBiodatas.length} biodata records.`);
  let updatedCount = 0;

  for (const b of allBiodatas) {
    const newFullName = normalizeTurkish(b.fullName);
    const newTempatLahir = normalizeTurkish(b.tempatLahir);
    const newNamaAyah = normalizeTurkish(b.namaAyah);
    const newNamaIbu = normalizeTurkish(b.namaIbu);
    const newAddress = normalizeTurkish(b.address);
    const newAlamatJalan = normalizeTurkish(b.alamatJalan);
    const newProv = normalizeTurkish(b.alamatProvName);
    const newKab = normalizeTurkish(b.alamatKabName);
    const newKec = normalizeTurkish(b.alamatKecName);
    const newKel = normalizeTurkish(b.alamatKelName);
    const newKontakNama = normalizeTurkish(b.kontakDaruratNama);

    const hasChanges =
      newFullName !== b.fullName ||
      newTempatLahir !== b.tempatLahir ||
      newNamaAyah !== b.namaAyah ||
      newNamaIbu !== b.namaIbu ||
      newAddress !== b.address ||
      newAlamatJalan !== b.alamatJalan ||
      newProv !== b.alamatProvName ||
      newKab !== b.alamatKabName ||
      newKec !== b.alamatKecName ||
      newKel !== b.alamatKelName ||
      newKontakNama !== b.kontakDaruratNama;

    if (hasChanges) {
      await prisma.biodata.update({
        where: { id: b.id },
        data: {
          fullName: newFullName,
          tempatLahir: newTempatLahir,
          namaAyah: newNamaAyah,
          namaIbu: newNamaIbu,
          address: newAddress,
          alamatJalan: newAlamatJalan,
          alamatProvName: newProv,
          alamatKabName: newKab,
          alamatKecName: newKec,
          alamatKelName: newKel,
          kontakDaruratNama: newKontakNama,
        }
      });
      console.log(`Updated biodata ${b.id}: "${b.fullName}" -> "${newFullName}"`);
      updatedCount++;
    }
  }

  console.log(`✅ Completed database Turkish character cleanup. ${updatedCount} records updated.`);
  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error('❌ Error updating database:', err);
  process.exit(1);
});
