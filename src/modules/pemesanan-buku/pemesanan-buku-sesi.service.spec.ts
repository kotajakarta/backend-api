/**
 * Run with:
 *   npx tsx --test src/modules/pemesanan-buku/pemesanan-buku-sesi.service.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PemesananBukuSesiService } from './pemesanan-buku-sesi.service.js';
import { createFakePrisma, seedDasar } from './pemesanan-buku.fixture.js';

const buat = () => {
  const prisma = createFakePrisma(seedDasar());
  return { prisma, svc: new PemesananBukuSesiService(prisma as any) };
};

describe('PemesananBukuSesiService', () => {
  it('listSesi mengembalikan sesi terbaru dulu dan sesi aktif', async () => {
    const { svc } = buat();
    const res = await svc.listSesi();
    assert.deepEqual(res.sesi.map((s) => s.id), ['sesi-1', 'sesi-0']);
    assert.equal(res.aktif?.id, 'sesi-1');
    assert.equal(res.aktif?.label, 'Semester Ganjil Tahun Ajaran 2026/2027');
  });

  it('createSesi menormalkan semester dan mengaktifkan hanya satu sesi', async () => {
    const { svc, prisma } = buat();
    const baru = await svc.createSesi({ tahunAjaran: '2026/2027', semester: 'Genap', isActive: true });
    assert.equal(baru.semester, 'GENAP');
    assert.deepEqual(prisma.db.sesiPemesananBuku.filter((s: any) => s.isActive).map((s: any) => s.id), [baru.id]);
  });

  it('createSesi menolak format salah dan duplikat', async () => {
    const { svc } = buat();
    await assert.rejects(svc.createSesi({ tahunAjaran: '2026-2027', semester: 'GANJIL' }), /YYYY\/YYYY/);
    await assert.rejects(svc.createSesi({ tahunAjaran: '2026/2027', semester: 'Pendek' }), /GANJIL atau GENAP/);
    await assert.rejects(svc.createSesi({ tahunAjaran: '2026/2027', semester: 'ganjil' }), /sudah ada/);
  });

  it('updateSesi menolak ganti TA bila sudah ada pesanan, tapi boleh buka/tutup', async () => {
    const { svc, prisma } = buat();
    prisma.db.pemesananBukuCabang.push({ id: 'p1', sesiId: 'sesi-1', cabangId: 'cab-a', wilayahId: 'wil-1', status: 'DRAFT_CABANG', nomor: 'N1' });
    await assert.rejects(svc.updateSesi('sesi-1', { tahunAjaran: '2027/2028' }), /sudah memiliki pesanan/);
    const res = await svc.updateSesi('sesi-1', { isOpen: false });
    assert.equal(res.isOpen, false);
  });

  it('updateSesi isActive=true menonaktifkan sesi lain', async () => {
    const { svc, prisma } = buat();
    await svc.updateSesi('sesi-0', { isActive: true });
    assert.deepEqual(prisma.db.sesiPemesananBuku.filter((s: any) => s.isActive).map((s: any) => s.id), ['sesi-0']);
  });

  it('deleteSesi hanya untuk sesi tanpa pesanan', async () => {
    const { svc, prisma } = buat();
    prisma.db.pemesananBukuWilayah.push({ id: 'w1', sesiId: 'sesi-1', wilayahId: 'wil-1', status: 'DRAFT_WILAYAH', nomor: 'W1' });
    await assert.rejects(svc.deleteSesi('sesi-1'), /tidak bisa dihapus/);
    assert.deepEqual(await svc.deleteSesi('sesi-0'), { success: true });
  });

  it('resolveSesi & assertTerbuka', async () => {
    const { svc, prisma } = buat();
    assert.equal((await svc.resolveSesi()).id, 'sesi-1');
    assert.equal((await svc.resolveSesi('sesi-0')).id, 'sesi-0');
    await assert.rejects(svc.resolveSesi('tidak-ada'), /tidak ditemukan/);
    assert.throws(() => svc.assertTerbuka(prisma.db.sesiPemesananBuku[1]), /tidak aktif atau sudah ditutup/);
    prisma.db.sesiPemesananBuku.forEach((s: any) => (s.isActive = false));
    await assert.rejects(svc.resolveSesi(), /Belum ada sesi pemesanan aktif/);
  });
});
