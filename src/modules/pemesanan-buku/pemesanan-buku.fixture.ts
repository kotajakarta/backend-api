/**
 * Fake Prisma in-memory untuk test modul pemesanan-buku. Hanya mendukung bentuk
 * query yang dipakai service (equality, `in`, `not`, OR/AND, compound unique,
 * include/select relasi items/cabang/wilayah). Tidak ada rollback transaksi.
 */
import { PemesananBukuService } from './pemesanan-buku.service.js';
import { PemesananBukuSesiService } from './pemesanan-buku-sesi.service.js';
import { PemesananBukuPdfService } from './pemesanan-buku-pdf.service.js';
import { hitungPesanan, type RombelRow } from './pemesanan-buku-hitung.js';

type Row = Record<string, any>;

const UNIQUE: Record<string, string[][]> = {
  sesiPemesananBuku: [['tahunAjaran', 'semester']],
  pemesananBukuCabang: [['sesiId', 'cabangId'], ['nomor']],
  pemesananBukuWilayah: [['sesiId', 'wilayahId'], ['nomor']],
  pemesananBukuCabangItem: [['pesananId', 'tingkat']],
};

export function cocok(row: Row, where?: Row): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Row[]).some((w) => cocok(row, w));
    if (k === 'AND') return (v as Row[]).every((w) => cocok(row, w));
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return (v.in as unknown[]).includes(row[k]);
      if ('not' in v) return row[k] !== v.not;
      return cocok(row, v); // compound unique: { sesiId_cabangId: { sesiId, cabangId } }
    }
    return row[k] === v;
  });
}

let seq = 0;
const idBaru = (p: string) => `${p}-${++seq}`;
const errorKode = (code: string) => Object.assign(new Error(code), { code });

export function createFakePrisma(seed: Record<string, Row[]> = {}) {
  const db: Record<string, Row[]> = {
    sesiPemesananBuku: [],
    pemesananBukuCabang: [],
    pemesananBukuCabangItem: [],
    pemesananBukuWilayah: [],
    cabang: [],
    wilayah: [],
    ...structuredClone(seed),
  };

  const lampirkan = (row: Row, rel?: Row): Row => {
    const out: Row = { ...row };
    if (!rel) return out;
    if (rel.items) out.items = db.pemesananBukuCabangItem.filter((i) => i.pesananId === row.id).sort((a, b) => a.tingkat - b.tingkat).map((i) => ({ ...i }));
    if (rel.cabang) out.cabang = { ...(db.cabang.find((c) => c.id === row.cabangId) ?? {}) };
    if (rel.wilayah) {
      const w = db.wilayah.find((x) => x.id === row.wilayahId);
      out.wilayah = w ? { ...w } : null;
    }
    return out;
  };

  const cekUnik = (name: string, row: Row, kecuali?: Row) => {
    for (const fields of UNIQUE[name] ?? []) {
      if (db[name].some((r) => r !== kecuali && fields.every((f) => r[f] === row[f]))) throw errorKode('P2002');
    }
  };

  const model = (name: string) => ({
    findUnique: async ({ where, include, select }: Row) => {
      const r = db[name].find((x) => cocok(x, where));
      return r ? lampirkan(r, include ?? select) : null;
    },
    findFirst: async ({ where, include, select }: Row = {}) => {
      const r = db[name].find((x) => cocok(x, where));
      return r ? lampirkan(r, include ?? select) : null;
    },
    findMany: async ({ where, include, select, orderBy }: Row = {}) => {
      let rows = db[name].filter((x) => cocok(x, where));
      if (orderBy?.name) rows = [...rows].sort((a, b) => String(a.name).localeCompare(String(b.name)));
      if (orderBy?.createdAt === 'desc') rows = [...rows].sort((a, b) => b.createdAt - a.createdAt);
      return rows.map((r) => lampirkan(r, include ?? select));
    },
    count: async ({ where }: Row = {}) => db[name].filter((x) => cocok(x, where)).length,
    create: async ({ data }: Row) => {
      const { items, ...rest } = data;
      const row: Row = { id: idBaru(name), createdAt: new Date(), updatedAt: new Date(), ...rest };
      cekUnik(name, row);
      db[name].push(row);
      for (const it of items?.create ?? []) db.pemesananBukuCabangItem.push({ id: idBaru('item'), pesananId: row.id, ...it });
      return { ...row };
    },
    createMany: async ({ data }: Row) => {
      for (const d of data as Row[]) {
        const row = { id: idBaru(name), ...d };
        cekUnik(name, row);
        db[name].push(row);
      }
      return { count: (data as Row[]).length };
    },
    update: async ({ where, data }: Row) => {
      const r = db[name].find((x) => cocok(x, where));
      if (!r) throw errorKode('P2025');
      const next = { ...r, ...data, updatedAt: new Date() };
      cekUnik(name, next, r);
      Object.assign(r, next);
      return { ...r };
    },
    updateMany: async ({ where, data }: Row) => {
      const rows = db[name].filter((x) => cocok(x, where));
      rows.forEach((r) => Object.assign(r, data, { updatedAt: new Date() }));
      return { count: rows.length };
    },
    delete: async ({ where }: Row) => {
      const i = db[name].findIndex((x) => cocok(x, where));
      if (i < 0) throw errorKode('P2025');
      const [r] = db[name].splice(i, 1);
      return r;
    },
    deleteMany: async ({ where }: Row = {}) => {
      const sebelum = db[name].length;
      db[name] = db[name].filter((x) => !cocok(x, where));
      return { count: sebelum - db[name].length };
    },
  });

  const prisma: Row = {
    db,
    sesiPemesananBuku: model('sesiPemesananBuku'),
    pemesananBukuCabang: model('pemesananBukuCabang'),
    pemesananBukuCabangItem: model('pemesananBukuCabangItem'),
    pemesananBukuWilayah: model('pemesananBukuWilayah'),
    cabang: model('cabang'),
    wilayah: model('wilayah'),
  };
  prisma.$transaction = async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg));
  return prisma;
}

export function createFakeStorage() {
  const files = new Map<string, Buffer>();
  return {
    files,
    simpan: async (key: string, buf: Buffer) => { files.set(key, buf); },
    ambil: async (key: string) => files.get(key) ?? null,
    hapus: async (key: string) => { files.delete(key); },
  };
}

export function seedDasar(): Record<string, Row[]> {
  return {
    sesiPemesananBuku: [
      { id: 'sesi-1', tahunAjaran: '2026/2027', semester: 'GANJIL', isActive: true, isOpen: true, createdAt: new Date('2026-09-01T00:00:00Z'), updatedAt: new Date() },
      { id: 'sesi-0', tahunAjaran: '2025/2026', semester: 'GENAP', isActive: false, isOpen: false, createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date() },
    ],
    wilayah: [
      { id: 'wil-1', name: 'Sumbagsel', isActive: true },
      { id: 'wil-2', name: 'Jawa Barat', isActive: true },
    ],
    cabang: [
      { id: 'cab-a', name: 'Jambi An-Nafiah', kode: 'JMB01', wilayahId: 'wil-1', isActive: true },
      { id: 'cab-b', name: 'Kalianda', kode: 'KLD01', wilayahId: 'wil-1', isActive: true },
      { id: 'cab-c', name: 'Cabang Kosong', kode: 'KSG01', wilayahId: 'wil-1', isActive: true },
      { id: 'cab-x', name: 'Tanpa Wilayah', kode: 'TW01', wilayahId: null, isActive: true },
      { id: 'cab-d', name: 'Bandung', kode: 'BDG01', wilayahId: 'wil-2', isActive: true },
    ],
  };
}

export const userCabang = (cabangId: string) => ({ id: `u-${cabangId}`, scope: 'CABANG', cabangId, wilayahId: null, operatorName: `Operator ${cabangId}` });
export const userWilayah = (wilayahId: string) => ({ id: `u-${wilayahId}`, scope: 'WILAYAH', cabangId: null, wilayahId, operatorName: `Admin ${wilayahId}` });
export const userGlobal = { id: 'u-global', scope: 'GLOBAL', cabangId: null, wilayahId: null, operatorName: 'Admin Pusat' };

/** Angka live default per cabang. Test boleh mengubah objek ini untuk mensimulasikan perubahan data santri. */
export const liveDefault = (): Record<string, RombelRow[]> => ({
  'cab-a': [
    { kelasId: 'k1', name: '10A', tingkat: '10', jumlahSantri: 26 },
    { kelasId: 'k2', name: 'XI IPA', tingkat: 'XI', jumlahSantri: 20 },
  ],
  'cab-b': [{ kelasId: 'k3', name: '8A', tingkat: 'VIII', jumlahSantri: 30 }],
  'cab-x': [{ kelasId: 'k4', name: '7A', tingkat: '7', jumlahSantri: 5 }],
  'cab-d': [{ kelasId: 'k5', name: '9A', tingkat: 'IX', jumlahSantri: 12 }],
});

/** hitungLive asli memakai relasi kelas/siswaFormal yang tidak didukung fake; ganti dengan data di `live`. */
export function stubLive(svc: any, live: Record<string, RombelRow[]>) {
  svc.hitungLive = async (ids: string[]) => new Map(ids.map((id) => [id, hitungPesanan(live[id] ?? [])]));
}

export function buatService(seed: Record<string, Row[]> = seedDasar(), live = liveDefault()) {
  const prisma = createFakePrisma(seed);
  const storage = createFakeStorage();
  const sesiService = new PemesananBukuSesiService(prisma as any);
  const svc = new PemesananBukuService(prisma as any, sesiService, new PemesananBukuPdfService(), storage as any);
  stubLive(svc, live);
  return { prisma, storage, svc, sesiService, live };
}
