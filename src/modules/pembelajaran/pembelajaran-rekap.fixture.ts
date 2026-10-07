/**
 * Test fixture for PembelajaranRekapService: a small in-memory dataset plus a
 * hand-mocked PrismaService that honours the where-clauses syncPeriod() uses
 * (kelasId IN, date range) and records every rekapPembelajaran.upsert() call.
 */

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const wilayahs = [
  { id: 'w1', name: 'Wilayah Satu' },
  { id: 'w2', name: 'Wilayah Dua' },
];

const cabangs = [
  { id: 'c1', name: 'Cabang A', wilayahId: 'w1', wilayah: wilayahs[0] },
  { id: 'c2', name: 'Cabang B', wilayahId: 'w1', wilayah: wilayahs[0] },
  { id: 'c3', name: 'Cabang C', wilayahId: 'w2', wilayah: wilayahs[1] },
];

const mapel = {
  m1: { id: 'm1', name: 'Matematika', aktifPembelajaran: true },
  m2: { id: 'm2', name: 'Bahasa', aktifPembelajaran: true },
};

const siswa = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}-s${i}`, studentId: `${prefix}-st${i}` }));

const kelas = [
  { id: 'k1', name: '7A', cabangId: 'c1', cabang: cabangs[0], ruang: null, lembagaMuadalah: null, siswaFormal: siswa(3, 'k1') },
  { id: 'k2', name: '7B', cabangId: 'c1', cabang: cabangs[0], ruang: null, lembagaMuadalah: null, siswaFormal: siswa(2, 'k2') },
  { id: 'k3', name: '8A', cabangId: 'c2', cabang: cabangs[1], ruang: null, lembagaMuadalah: null, siswaFormal: siswa(4, 'k3') },
  { id: 'k4', name: '9A', cabangId: 'c3', cabang: cabangs[2], ruang: null, lembagaMuadalah: null, siswaFormal: siswa(1, 'k4') },
  { id: 'k5', name: 'Tanpa', cabangId: null, cabang: null, ruang: null, lembagaMuadalah: null, siswaFormal: [] },
];

const guru = { g1: { id: 'g1', name: 'Ust. Ali' }, g2: { id: 'g2', name: 'Ust. Budi' } };

let pelSeq = 0;
const pel = (kelasId: string, mid: 'm1' | 'm2', tanggal: string, status: string, catatan: string | null = null, g: 'g1' | 'g2' | null = 'g1') => ({
  id: `p${++pelSeq}`,
  kelasId,
  mataPelajaranId: mid,
  tanggalDiajar: d(tanggal),
  status,
  catatan,
  guruId: g,
  guru: g ? guru[g] : null,
  mataPelajaran: mapel[mid],
  silabusId: `sil-${mid}`,
  silabus: { id: `sil-${mid}`, judul: 'Bab 1', mataPelajaran: mapel[mid] },
});

const pelaksanaan = [
  pel('k1', 'm1', '2025-08-02', 'COMPLETED'),
  pel('k1', 'm2', '2025-08-02', 'COMPLETED', null, 'g2'),
  pel('k1', 'm1', '2025-08-09', 'LIBUR', 'Libur HUT RI'),
  pel('k2', 'm1', '2025-08-09', 'COMPLETED', 'catatan guru'),
  pel('k2', 'm1', '2025-08-16', 'LIBUR', 'Libur HUT RI'),
  pel('k3', 'm2', '2025-08-16', 'COMPLETED', null, null),
  pel('k3', 'm2', '2025-08-23', 'LIBUR', 'Rapat'),
  pel('k4', 'm1', '2025-08-30', 'COMPLETED'),
  pel('k4', 'm1', '2025-09-06', 'COMPLETED'),
  pel('k1', 'm1', '2025-10-04', 'COMPLETED'),
  pel('k5', 'm2', '2025-08-02', 'COMPLETED'),
];

let absSeq = 0;
const abs = (kelasId: string, mid: 'm1' | 'm2', tanggal: string, status: string) => ({
  id: `a${++absSeq}`,
  kelasId,
  mataPelajaranId: mid,
  tanggal: d(tanggal),
  status,
  mataPelajaran: mapel[mid],
  silabusId: `sil-${mid}`,
  silabus: { id: `sil-${mid}`, judul: 'Bab 1' },
});

const absensi = [
  abs('k1', 'm1', '2025-08-02', 'HADIR'), abs('k1', 'm1', '2025-08-02', 'HADIR'), abs('k1', 'm1', '2025-08-02', 'SAKIT'),
  abs('k1', 'm2', '2025-08-02', 'HADIR'), abs('k1', 'm2', '2025-08-02', 'IZIN'),
  abs('k2', 'm1', '2025-08-09', 'HADIR'), abs('k2', 'm1', '2025-08-09', 'ALPA'),
  // absensi tanpa pelaksanaan (detail dibuat dari sisi absensi)
  abs('k2', 'm2', '2025-08-23', 'HADIR'), abs('k2', 'm2', '2025-08-23', 'HADIR'),
  abs('k3', 'm2', '2025-08-16', 'HADIR'), abs('k3', 'm2', '2025-08-16', 'SAKIT'),
  abs('k4', 'm1', '2025-08-30', 'ALPA'),
  abs('k4', 'm1', '2025-09-06', 'HADIR'),
  abs('k1', 'm1', '2025-10-04', 'HADIR'),
];

function inRange(v: Date, r: { gte?: Date; lte?: Date } | undefined) {
  if (!r) return true;
  if (r.gte && v < r.gte) return false;
  if (r.lte && v > r.lte) return false;
  return true;
}

function kelasFilter(where: any) {
  const ids = where?.kelasId?.in ? new Set<string>(where.kelasId.in) : null;
  return (row: any) => !ids || ids.has(row.kelasId);
}

type RekapDataset = {
  wilayahs: any[];
  cabangs: any[];
  kelas: any[];
  pelaksanaan: any[];
  absensi: any[];
  mapel: Record<string, any>;
};

const smallDataset: RekapDataset = { wilayahs, cabangs, kelas, pelaksanaan, absensi, mapel };

/**
 * Production-shaped dataset for performance tests: many cabang, a few kelas
 * each, weekly Saturday lessons across the whole Ganjil 2025 semester.
 */
export function makeLargeDataset(opts: { wilayah: number; cabangPerWilayah: number; kelasPerCabang: number; siswaPerKelas: number }): RekapDataset {
  const ws: any[] = [];
  const cs: any[] = [];
  const ks: any[] = [];
  const ps: any[] = [];
  const as: any[] = [];
  const mids = ['m1', 'm2'] as const;
  const saturdays: string[] = [];
  for (let t = Date.UTC(2025, 6, 5); t <= Date.UTC(2025, 11, 27); t += 7 * 86400000) {
    saturdays.push(new Date(t).toISOString().slice(0, 10));
  }
  const statuses = ['HADIR', 'HADIR', 'HADIR', 'SAKIT', 'IZIN', 'ALPA'];
  for (let w = 0; w < opts.wilayah; w++) {
    const wil = { id: `W${w}`, name: `Wilayah ${w}` };
    ws.push(wil);
    for (let c = 0; c < opts.cabangPerWilayah; c++) {
      const cab = { id: `W${w}C${c}`, name: `Cabang ${w}-${c}`, wilayahId: wil.id, wilayah: wil };
      cs.push(cab);
      for (let k = 0; k < opts.kelasPerCabang; k++) {
        const kel = { id: `${cab.id}K${k}`, name: `Kelas ${k}`, cabangId: cab.id, cabang: cab, siswaFormal: siswa(opts.siswaPerKelas, `${cab.id}K${k}`) };
        ks.push(kel);
        saturdays.forEach((tgl, i) => {
          for (const mid of mids) {
            const status = i % 9 === 0 ? 'LIBUR' : 'COMPLETED';
            ps.push({
              kelasId: kel.id, mataPelajaranId: mid, tanggalDiajar: d(tgl), status,
              catatan: status === 'LIBUR' ? 'Libur' : null,
              guru: guru.g1, mataPelajaran: mapel[mid], silabus: { mataPelajaran: mapel[mid] },
            });
            if (status === 'LIBUR') continue;
            for (let s = 0; s < opts.siswaPerKelas; s++) {
              as.push({ kelasId: kel.id, mataPelajaranId: mid, tanggal: d(tgl), status: statuses[(s + i) % statuses.length], mataPelajaran: mapel[mid] });
            }
          }
        });
      }
    }
  }
  return { wilayahs: ws, cabangs: cs, kelas: ks, pelaksanaan: ps, absensi: as, mapel };
}

// Mimics Prisma's `select`: only the selected fields (and nested selects) come back,
// so the golden test fails if syncPeriod() relies on a field it no longer loads.
function project(row: any, select: any): any {
  if (!select) return row;
  const out: any = {};
  for (const [field, spec] of Object.entries<any>(select)) {
    if (!spec) continue;
    if (field === '_count') {
      out._count = {};
      for (const rel of Object.keys(spec.select)) out._count[rel] = (row[rel] || []).length;
      continue;
    }
    const v = row[field];
    out[field] = spec === true || v == null ? v : Array.isArray(v) ? v.map(x => project(x, spec.select)) : project(v, spec.select);
  }
  return out;
}

export function makeRekapPrisma(data: RekapDataset = smallDataset, opts: { recordUpserts?: boolean } = {}) {
  const { wilayahs, cabangs, kelas, pelaksanaan, absensi, mapel } = data;
  const recordUpserts = opts.recordUpserts ?? true;
  const upserts: any[] = [];
  const findManyArgs: Record<string, any[]> = {};
  const record = (model: string, args: any) => {
    (findManyArgs[model] ||= []).push(args);
  };
  const clone = <T>(v: T): T => structuredClone(v);

  const prisma: any = {
    kelas: {
      findMany: async (args: any) => {
        record('kelas', args);
        return clone(kelas).map((k: any) => project(k, args.select));
      },
    },
    pelaksanaanSilabus: {
      findMany: async (args: any) => {
        record('pelaksanaanSilabus', args);
        return clone(pelaksanaan.filter(kelasFilter(args.where)).filter(p => inRange(p.tanggalDiajar, args.where?.tanggalDiajar))).map(r => project(r, args.select));
      },
    },
    absensiMapel: {
      findMany: async (args: any) => {
        record('absensiMapel', args);
        return clone(absensi.filter(kelasFilter(args.where)).filter(a => inRange(a.tanggal, args.where?.tanggal))).map(r => project(r, args.select));
      },
    },
    mataPelajaran: {
      findMany: async (args: any) => {
        record('mataPelajaran', args);
        const ids: string[] | undefined = args?.where?.id?.in;
        return clone(Object.values(mapel).filter(m => !ids || ids.includes(m.id))).map(r => project(r, args?.select));
      },
    },
    wilayah: { findMany: async (args: any) => clone(wilayahs).map(r => project(r, args?.select)) },
    cabang: { findMany: async (args: any) => clone(cabangs).map(r => project(r, args?.select)) },
    pengaturanAkademik: {
      findFirst: async () => ({ tahunAjaran: '2025/2026', semesterAktif: 'Ganjil' }),
    },
    rekapPembelajaran: {
      // Serves back whatever upsert() stored, matching on plain-equality where fields.
      findMany: async (args: any) =>
        upserts
          .filter(Boolean)
          .map(u => u.create)
          .filter(row => Object.entries(args.where || {}).every(([k, v]) => row[k] === v)),
      upsert: async (args: any) => {
        upserts.push(recordUpserts ? JSON.parse(JSON.stringify(args)) : null);
        return args.create;
      },
    },
  };

  return { prisma, upserts, findManyArgs };
}
