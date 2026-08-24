import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const cleanEnv = (val?: string, defaultVal: string = ''): string => {
  if (!val) return defaultVal;
  return val.trim().replace(/^["']|["']$/g, '').trim();
};

const connectionString = cleanEnv(process.env.DATABASE_URL);
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const BASE_URL = 'https://wil.nri.my.id/api/wilayah';
const cache = new Map<string, any[]>();

async function fetchWilayah(endpoint: string = ''): Promise<any[]> {
  const url = endpoint ? `${BASE_URL}${endpoint}` : BASE_URL;
  if (cache.has(url)) return cache.get(url)!;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    cache.set(url, data);
    return data;
  } catch (e) {
    console.error(`Gagal fetch ${url}:`, e);
    return [];
  }
}

function cleanName(name?: string | null): string {
  return String(name || '')
    .toLowerCase()
    .replace(/^(kabupaten|kab\.|kota|kecamatan|kec\.|desa|kelurahan|kel\.)\s+/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function findMatch(list: any[], targetCode?: string | null, targetName?: string | null, extraJalan?: string | null): any {
  if (!list || list.length === 0) return null;
  const cleanTargetName = String(targetName || '').trim().toLowerCase();
  const cleanTargetCode = String(targetCode || '').trim();

  // 1. Exact code match
  if (cleanTargetCode && cleanTargetCode.includes('.')) {
    const exact = list.find(item => item.kode === cleanTargetCode);
    if (exact) return exact;
  }

  // 2. Exact full name match
  if (cleanTargetName) {
    const exactName = list.find(item => String(item.nama || '').trim().toLowerCase() === cleanTargetName);
    if (exactName) return exactName;

    // 2b. Stripped name match
    const strippedTarget = cleanName(cleanTargetName);
    if (strippedTarget) {
      const strippedMatch = list.find(item => cleanName(item.nama) === strippedTarget);
      if (strippedMatch) return strippedMatch;
    }
  }

  // 3. Fallback: Suffix 3-digit matcher (Emsifa 10-digit code -> Kemendagri dotted code)
  if (cleanTargetCode && cleanTargetCode.length >= 8) {
    const rawSuffix = cleanTargetCode.slice(cleanTargetCode.length - 3);
    if (rawSuffix && !isNaN(Number(rawSuffix))) {
      const suffixMatch = list.find(item => item.kode.endsWith(rawSuffix));
      if (suffixMatch) return suffixMatch;
    }
  }

  // 4. Fallback: Search village name inside alamatJalan
  if (extraJalan) {
    const cleanJalan = cleanName(extraJalan);
    if (cleanJalan) {
      const jalanMatch = list.find(item => {
        const itemClean = cleanName(item.nama);
        return itemClean.length >= 4 && cleanJalan.includes(itemClean);
      });
      if (jalanMatch) return jalanMatch;
    }
  }

  // 5. Substring name match
  if (cleanTargetName) {
    const strippedTarget = cleanName(cleanTargetName);
    if (strippedTarget) {
      const subMatch = list.find(item => {
        const itemStripped = cleanName(item.nama);
        return itemStripped.includes(strippedTarget) || strippedTarget.includes(itemStripped);
      });
      if (subMatch) return subMatch;
    }
  }

  return null;
}

async function resolveAddress(
  provId?: string | null,
  provName?: string | null,
  kabId?: string | null,
  kabName?: string | null,
  kecId?: string | null,
  kecName?: string | null,
  kelId?: string | null,
  kelName?: string | null,
  jalan?: string | null
) {
  const provinces = await fetchWilayah();
  const matchedProv = findMatch(provinces, provId, provName);
  if (!matchedProv) {
    return { provId, provName, kabId, kabName, kecId, kecName, kelId, kelName };
  }

  const finalProvId = matchedProv.kode;
  const finalProvName = matchedProv.nama;

  const regencies = await fetchWilayah(`?parent=${finalProvId}`);
  const matchedKab = findMatch(regencies, kabId, kabName);
  if (!matchedKab) {
    return { provId: finalProvId, provName: finalProvName, kabId, kabName, kecId, kecName, kelId, kelName };
  }

  const finalKabId = matchedKab.kode;
  const finalKabName = matchedKab.nama;

  const districts = await fetchWilayah(`?parent=${finalKabId}`);
  const matchedKec = findMatch(districts, kecId, kecName);
  if (!matchedKec) {
    return { provId: finalProvId, provName: finalProvName, kabId: finalKabId, kabName: finalKabName, kecId, kecName, kelId, kelName };
  }

  const finalKecId = matchedKec.kode;
  const finalKecName = matchedKec.nama;

  const villages = await fetchWilayah(`?parent=${finalKecId}`);
  const matchedKel = findMatch(villages, kelId, kelName, jalan);
  const finalKelId = matchedKel ? matchedKel.kode : kelId;
  const finalKelName = matchedKel ? matchedKel.nama : kelName;

  return {
    provId: finalProvId,
    provName: finalProvName,
    kabId: finalKabId,
    kabName: finalKabName,
    kecId: finalKecId,
    kecName: finalKecName,
    kelId: finalKelId,
    kelName: finalKelName,
  };
}

async function migrate() {
  console.log('🚀 Memulai migrasi kode wilayah cerdas terhubung ke Wilindo API...');

  // 1. Migrasi Biodata Santri
  const biodataList = await prisma.biodata.findMany({
    select: {
      id: true,
      alamatProvId: true,
      alamatProvName: true,
      alamatKabId: true,
      alamatKabName: true,
      alamatKecId: true,
      alamatKecName: true,
      alamatKelId: true,
      alamatKelName: true,
      alamatJalan: true,
    }
  });

  console.log(`📦 Memproses ${biodataList.length} data biodata santri...`);
  let updatedBiodata = 0;

  for (const b of biodataList) {
    if (!b.alamatProvName && !b.alamatProvId) continue;

    const resolved = await resolveAddress(
      b.alamatProvId,
      b.alamatProvName,
      b.alamatKabId,
      b.alamatKabName,
      b.alamatKecId,
      b.alamatKecName,
      b.alamatKelId,
      b.alamatKelName,
      b.alamatJalan
    );

    const hasChanges =
      resolved.provId !== b.alamatProvId ||
      resolved.provName !== b.alamatProvName ||
      resolved.kabId !== b.alamatKabId ||
      resolved.kabName !== b.alamatKabName ||
      resolved.kecId !== b.alamatKecId ||
      resolved.kecName !== b.alamatKecName ||
      resolved.kelId !== b.alamatKelId ||
      resolved.kelName !== b.alamatKelName;

    if (hasChanges) {
      await prisma.biodata.update({
        where: { id: b.id },
        data: {
          alamatProvId: resolved.provId,
          alamatProvName: resolved.provName,
          alamatKabId: resolved.kabId,
          alamatKabName: resolved.kabName,
          alamatKecId: resolved.kecId,
          alamatKecName: resolved.kecName,
          alamatKelId: resolved.kelId,
          alamatKelName: resolved.kelName,
        }
      });
      updatedBiodata++;
      console.log(`  ✓ Biodata [${b.id.slice(0, 8)}]: ${resolved.provName} > ${resolved.kabName} > ${resolved.kecName} > ${resolved.kelName}`);
    }
  }

  // 2. Migrasi Cabang
  const cabangList = await prisma.cabang.findMany({
    select: {
      id: true,
      name: true,
      alamatProvId: true,
      alamatProvName: true,
      alamatKabId: true,
      alamatKabName: true,
      alamatKecId: true,
      alamatKecName: true,
      alamatKelId: true,
      alamatKelName: true,
      alamatJalan: true,
    }
  });

  console.log(`\n📦 Memproses ${cabangList.length} data cabang...`);
  let updatedCabang = 0;

  for (const c of cabangList) {
    if (!c.alamatProvName && !c.alamatProvId) continue;

    const resolved = await resolveAddress(
      c.alamatProvId,
      c.alamatProvName,
      c.alamatKabId,
      c.alamatKabName,
      c.alamatKecId,
      c.alamatKecName,
      c.alamatKelId,
      c.alamatKelName,
      c.alamatJalan
    );

    const hasChanges =
      resolved.provId !== c.alamatProvId ||
      resolved.provName !== c.alamatProvName ||
      resolved.kabId !== c.alamatKabId ||
      resolved.kabName !== c.alamatKabName ||
      resolved.kecId !== c.alamatKecId ||
      resolved.kecName !== c.alamatKecName ||
      resolved.kelId !== c.alamatKelId ||
      resolved.kelName !== c.alamatKelName;

    if (hasChanges) {
      await prisma.cabang.update({
        where: { id: c.id },
        data: {
          alamatProvId: resolved.provId,
          alamatProvName: resolved.provName,
          alamatKabId: resolved.kabId,
          alamatKabName: resolved.kabName,
          alamatKecId: resolved.kecId,
          alamatKecName: resolved.kecName,
          alamatKelId: resolved.kelId,
          alamatKelName: resolved.kelName,
        }
      });
      updatedCabang++;
      console.log(`  ✓ Cabang [${c.name}]: ${resolved.provName} > ${resolved.kabName} > ${resolved.kecName} > ${resolved.kelName}`);
    }
  }

  console.log('\n=============================================');
  console.log(`🎉 Migrasi Kode Wilayah Selesai!`);
  console.log(` - Biodata Santri Terupdate : ${updatedBiodata} / ${biodataList.length}`);
  console.log(` - Cabang Terupdate         : ${updatedCabang} / ${cabangList.length}`);
  console.log('=============================================\n');
}

migrate()
  .catch((err) => {
    console.error('❌ Terjadi kesalahan saat migrasi:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
