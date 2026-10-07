/**
 * Unit tests for MasterDataService — keeping base64 documents/photos out of list endpoints.
 *
 * Same test-infra approach as src/modules/portal/portal.service.spec.ts:
 * Node's built-in test runner (`node:test`) executed through `tsx`, no live
 * database — PrismaService is a hand-mocked object over an in-memory dataset.
 *
 * Run with:
 *   npx tsx --test src/modules/core/master/master-data.service.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MasterDataService } from './master-data.service.js';

const B64 = 'data:image/jpeg;base64,' + 'A'.repeat(1000);

const staffRows = [
  { id: 's1', name: 'Ali', cabangId: 'c1', wilayahId: 'w1', statusPool: 'AKTIF_CABANG', ktpUrl: B64, ijazahUrl: B64, ifadahUrl: null },
  { id: 's2', name: 'Budi', cabangId: 'c1', wilayahId: 'w1', statusPool: 'AKTIF_CABANG', ktpUrl: '', ijazahUrl: null, ifadahUrl: B64 },
];

const cabangRows = [
  { id: 'c1', name: 'Cabang A', wilayahId: 'w1', isActive: true, fotoPlang: B64, fotoGedung: null, fotoKelas: B64, fotoMushala: '', staff: [], students: [], wilayah: null, targetKuota: null },
];

// Evaluates the `{ AND: [{ f: { not: null } }, { f: { not: '' } }] }` presence filter.
function matchesPresence(row: any, where: any) {
  if (where?.id?.in && !where.id.in.includes(row.id)) return false;
  for (const cond of where?.AND || []) {
    const [field, c] = Object.entries<any>(cond)[0];
    if ('not' in c && row[field] === c.not) return false;
    if ('not' in c && c.not === null && row[field] == null) return false;
  }
  return true;
}

function makePrisma() {
  const calls: Record<string, any[]> = {};
  const rec = (k: string, a: any) => ((calls[k] ||= []).push(a), a);
  const prisma: any = {
    staff: {
      findMany: async (args: any) => {
        rec('staff.findMany', args);
        if (args?.where?.AND) return staffRows.filter(r => matchesPresence(r, args.where)).map(r => ({ id: r.id }));
        // list query: return only the selected scalar columns
        return staffRows.map(r => Object.fromEntries(Object.keys(args.select || r).filter(k => k in r).map(k => [k, (r as any)[k]])));
      },
      findUnique: async (args: any) => {
        rec('staff.findUnique', args);
        return { ...staffRows[0] };
      },
      update: async (args: any) => {
        rec('staff.update', args);
        return { id: args.where.id, ...args.data };
      },
      create: async (args: any) => {
        rec('staff.create', args);
        return { ...args.data };
      },
    },
    cabang: {
      findMany: async (args: any) => {
        rec('cabang.findMany', args);
        if (args?.where?.AND) return cabangRows.filter(r => matchesPresence(r, args.where)).map(r => ({ id: r.id }));
        const { fotoPlang, fotoGedung, fotoKelas, fotoMushala, ...rest } = cabangRows[0];
        return [structuredClone(rest)];
      },
      findUnique: async (args: any) => {
        rec('cabang.findUnique', args);
        return { ...cabangRows[0] };
      },
      update: async (args: any) => {
        rec('cabang.update', args);
        return { id: args.where.id, name: 'Cabang A', ...args.data };
      },
    },
    jenisGrupDaimi: { findMany: async () => [] },
    student: { count: async () => 0, groupBy: async () => [] },
    siswaFormal: { findMany: async () => [] },
  };
  return { prisma, calls };
}

const auditLog: any = { log: async () => {} };

function makeMinio() {
  const uploaded = new Map<string, Buffer>();
  const deleted: string[] = [];
  const minio: any = {
    uploadBuffer: async (key: string, buffer: Buffer) => (uploaded.set(key, buffer), { key, url: `/uploads/${key}` }),
    deleteObject: async (key: string) => { deleted.push(key); },
  };
  return { minio, uploaded, deleted };
}
const noMinio = makeMinio().minio;
const GLOBAL = { scope: 'GLOBAL' };

describe('MasterDataService — guru documents', () => {
  it('getGuru does not load base64 documents for the list', async () => {
    const { prisma, calls } = makePrisma();
    await new MasterDataService(prisma, auditLog, noMinio).getGuru(GLOBAL);
    const listArgs = calls['staff.findMany'].find((a: any) => !a.where?.AND);
    for (const f of ['ktpUrl', 'ijazahUrl', 'ifadahUrl']) assert.equal(listArgs.select[f], undefined, `${f} must not be selected`);
  });

  it('getGuru reports which documents each guru has (empty string counts as missing)', async () => {
    const { prisma } = makePrisma();
    const rows: any[] = await new MasterDataService(prisma, auditLog, noMinio).getGuru(GLOBAL);
    const byId = Object.fromEntries(rows.map(r => [r.id, r]));
    assert.deepEqual(
      { ktp: byId.s1.hasKtp, ijazah: byId.s1.hasIjazah, ifadah: byId.s1.hasIfadah },
      { ktp: true, ijazah: true, ifadah: false }
    );
    assert.deepEqual(
      { ktp: byId.s2.hasKtp, ijazah: byId.s2.hasIjazah, ifadah: byId.s2.hasIfadah },
      { ktp: false, ijazah: false, ifadah: true }
    );
    for (const r of rows) assert.equal(r.ktpUrl, undefined);
  });

  it('getGuruById still returns the documents (opted back in)', async () => {
    const { prisma, calls } = makePrisma();
    await new MasterDataService(prisma, auditLog, noMinio).getGuruById('s1', GLOBAL);
    const args = calls['staff.findUnique'][0];
    assert.deepEqual(args.omit, { ktpUrl: false, ijazahUrl: false, ifadahUrl: false });
  });

  it('updateGuru only clears a document on an explicit null, never on missing or empty values', async () => {
    // Old browser tabs (pre-deploy JS) prefill the edit form from the guru list,
    // which no longer carries documents, and would send '' for every document on
    // save — that must not wipe the stored KTP/ijazah/ifadah.
    const { prisma, calls } = makePrisma();
    await new MasterDataService(prisma, auditLog, noMinio).updateGuru(
      's1',
      { name: 'Ali', position: 'Guru', ktpUrl: null, ijazahUrl: '', ifadahUrl: B64 },
      GLOBAL
    );
    const data = calls['staff.update'][0].data;
    assert.equal(data.ktpUrl, null, 'explicit null clears the document');
    assert.equal(data.ijazahUrl, undefined, "'' (legacy client default) must leave the document untouched");
    assert.match(data.ifadahUrl, /^\/uploads\/staff\/s1\/ifadah-url-.+\.jpg$/, 'a new upload is stored in MinIO');

    await new MasterDataService(prisma, auditLog, noMinio).updateGuru('s1', { name: 'Ali', position: 'Guru' }, GLOBAL);
    const data2 = calls['staff.update'][1].data;
    for (const f of ['ktpUrl', 'ijazahUrl', 'ifadahUrl']) assert.equal(data2[f], undefined, `unsent ${f} must not be written`);
  });
});

describe('MasterDataService — cabang photos', () => {
  it('getCabang reports which of the listed photos are filled without loading them', async () => {
    const { prisma, calls } = makePrisma();
    const rows: any[] = await new MasterDataService(prisma, auditLog, noMinio).getCabang(GLOBAL);
    const listArgs = calls['cabang.findMany'].find((a: any) => !a.where?.AND);
    for (const f of ['fotoPlang', 'fotoGedung', 'fotoKelas', 'fotoMushala']) assert.equal(listArgs.select[f], undefined);
    assert.deepEqual(
      { plang: rows[0].hasFotoPlang, gedung: rows[0].hasFotoGedung, kelas: rows[0].hasFotoKelas, mushala: rows[0].hasFotoMushala },
      { plang: true, gedung: false, kelas: true, mushala: false }
    );
  });

  it('getCabangProfile still returns the photos (opted back in)', async () => {
    const { prisma, calls } = makePrisma();
    await new MasterDataService(prisma, auditLog, noMinio).getCabangProfile('c1');
    const args = calls['cabang.findUnique'][0];
    for (const f of ['fotoPlang', 'fotoGedung', 'fotoHalaman', 'fotoDenah', 'fotoMushala', 'fotoKelas', 'fotoRuangTidur', 'fotoRuangMakan', 'fotoKamarMandi']) {
      assert.equal(args.omit?.[f], false, `${f} must be opted back in`);
    }
  });
});

describe('MasterDataService — files go to MinIO, not the database', () => {
  it('updateGuru uploads a base64 document and stores only its /uploads path', async () => {
    const { prisma, calls } = makePrisma();
    const { minio, uploaded } = makeMinio();
    await new MasterDataService(prisma, auditLog, minio).updateGuru('s1', { name: 'Ali', position: 'Guru', ijazahUrl: B64 }, GLOBAL);
    const data = calls['staff.update'][0].data;
    assert.match(data.ijazahUrl, /^\/uploads\/staff\/s1\/ijazah-url-[0-9a-f-]{36}\.jpg$/);
    assert.equal(uploaded.size, 1);
    // current documents are loaded (opted in) so replaced objects can be cleaned up
    assert.deepEqual(calls['staff.findUnique'][0].omit, { ktpUrl: false, ijazahUrl: false, ifadahUrl: false });
  });

  it('createGuru stores new documents under the new staff id', async () => {
    const { prisma, calls } = makePrisma();
    const { minio } = makeMinio();
    await new MasterDataService(prisma, auditLog, minio).createGuru({ name: 'Baru', position: 'Guru', ktpUrl: B64 }, GLOBAL);
    const data = calls['staff.create'][0].data;
    assert.match(data.id, /^[0-9a-f-]{36}$/);
    assert.equal(data.ktpUrl.startsWith(`/uploads/staff/${data.id}/ktp-url-`), true);
    assert.equal(data.ijazahUrl, null);
  });

  it('updateCabangProfile uploads new photos, keeps unchanged ones and clears removed ones', async () => {
    const { prisma, calls } = makePrisma();
    const { minio, uploaded } = makeMinio();
    cabangRows[0].fotoGedung = '/uploads/cabang/c1/foto-gedung-old.jpg' as any;
    try {
      await new MasterDataService(prisma, auditLog, minio).updateCabangProfile('c1', {
        fotoPlang: B64,
        fotoGedung: '/uploads/cabang/c1/foto-gedung-old.jpg',
        fotoKelas: '',
      });
    } finally {
      cabangRows[0].fotoGedung = null as any;
    }
    const data = calls['cabang.update'][0].data;
    assert.match(data.fotoPlang, /^\/uploads\/cabang\/c1\/foto-plang-.+\.jpg$/);
    assert.equal(data.fotoGedung, '/uploads/cabang/c1/foto-gedung-old.jpg');
    assert.equal(data.fotoKelas, null);
    assert.equal(data.fotoMushala, null, 'profile form semantics: a photo not sent is cleared');
    assert.equal(uploaded.size, 1);
    assert.deepEqual(calls['cabang.findUnique'][0].omit?.fotoGedung, false, 'current photos are loaded for comparison');
  });
});
