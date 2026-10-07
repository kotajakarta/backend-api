/**
 * Run with:
 *   npx tsx --test src/modules/pemesanan-buku/pemesanan-buku-cabang.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buatService, seedDasar, userCabang, userWilayah, userGlobal } from './pemesanan-buku.fixture.js';

const A = userCabang('cab-a');

describe('PemesananBukuService — cabang', () => {
  it('getCabang: BELUM dengan angka live dan rombel sumber', async () => {
    const { svc } = buatService();
    const v = await svc.getCabang(A);
    assert.equal(v.status, 'BELUM');
    assert.equal(v.sesi.id, 'sesi-1');
    assert.equal(v.cabang.wilayahName, 'Sumbagsel');
    assert.equal(v.live!.items.find((i) => i.tingkat === 10)!.total, 27);
    assert.equal(v.live!.items.find((i) => i.tingkat === 11)!.total, 21);
    assert.equal(v.live!.grandTotal, 48);
    assert.equal(v.snapshot, null);
    assert.equal(v.berubah, false);
  });

  it('simpanDraftCabang membuat snapshot 6 item; berubah=true bila data santri berubah', async () => {
    const { svc, prisma, live } = buatService();
    const v = await svc.simpanDraftCabang(A, 'sesi-1');
    assert.equal(v.status, 'DRAFT_CABANG');
    assert.equal(v.nomor, 'PBM/2026-2027/GANJIL/C/JMB01');
    assert.equal(prisma.db.pemesananBukuCabangItem.length, 6);
    live['cab-a'][0].jumlahSantri = 31;
    assert.equal((await svc.getCabang(A)).berubah, true);
    await svc.simpanDraftCabang(A, 'sesi-1');
    const v2 = await svc.getCabang(A);
    assert.equal(v2.berubah, false);
    assert.equal(v2.snapshot!.items.find((i) => i.tingkat === 10)!.total, 33);
    assert.equal(prisma.db.pemesananBukuCabangItem.length, 6, 'item lama diganti, bukan ditambah');
  });

  it('submitCabang mengunci; aksi berikutnya ditolak', async () => {
    const { svc, live } = buatService();
    const v = await svc.submitCabang(A, 'sesi-1');
    assert.equal(v.status, 'SUBMITTED_CABANG');
    assert.equal(v.submittedByName, 'Operator cab-a');
    assert.equal(v.live, null);
    live['cab-a'][0].jumlahSantri = 99;
    assert.equal((await svc.getCabang(A)).snapshot!.grandTotal, 48, 'snapshot tidak ikut berubah');
    await assert.rejects(svc.submitCabang(A, 'sesi-1'), /sudah dikunci/);
    await assert.rejects(svc.simpanDraftCabang(A, 'sesi-1'), /sudah dikunci/);
  });

  it('submit tanpa santri ditolak; cabang tanpa wilayah ditolak', async () => {
    const { svc } = buatService();
    await assert.rejects(svc.submitCabang(userCabang('cab-c'), 'sesi-1'), /Tidak ada santri/);
    await assert.rejects(svc.submitCabang(userCabang('cab-x'), 'sesi-1'), /belum terhubung ke wilayah/);
  });

  it('sesi bukan aktif / ditutup ditolak (sesiId lama dari tab yang masih terbuka)', async () => {
    const { svc, prisma } = buatService();
    await assert.rejects(svc.submitCabang(A, 'sesi-0'), /tidak aktif atau sudah ditutup/);
    prisma.db.sesiPemesananBuku[0].isOpen = false;
    await assert.rejects(svc.simpanDraftCabang(A, 'sesi-1'), /tidak aktif atau sudah ditutup/);
  });

  it('scope: hanya akun CABANG yang boleh menulis; cabang lain 403', async () => {
    const { svc } = buatService();
    await assert.rejects(svc.submitCabang(userWilayah('wil-1') as any, 'sesi-1'), /hanya untuk akun Cabang/);
    await assert.rejects(svc.getCabang(A, undefined, 'cab-b'), /Akses ditolak/);
    await assert.rejects(svc.getCabang(userWilayah('wil-2'), undefined, 'cab-a'), /Akses ditolak/);
    assert.equal((await svc.getCabang(userWilayah('wil-1'), undefined, 'cab-a')).cabang.id, 'cab-a');
    assert.equal((await svc.getCabang(userGlobal, undefined, 'cab-a')).cabang.id, 'cab-a');
    await assert.rejects(svc.getCabang(userGlobal), /cabangId wajib/);
  });

  it('race: status berubah di antara baca dan tulis → 409', async () => {
    const { svc, prisma } = buatService();
    await svc.simpanDraftCabang(A, 'sesi-1');
    const asli = prisma.pemesananBukuCabang.findUnique;
    prisma.pemesananBukuCabang.findUnique = async (args: any) => {
      const r = await asli(args);
      prisma.db.pemesananBukuCabang[0].status = 'SUBMITTED_CABANG'; // tab lain sudah submit
      return r;
    };
    await assert.rejects(svc.submitCabang(A, 'sesi-1'), (e: any) => e.status === 409);
  });

  it('submit cabang menghapus scan wilayah draft yang sudah basi; ditolak bila wilayah terkunci', async () => {
    const { svc, prisma, storage } = buatService();
    storage.files.set('ttd-lama', Buffer.from('x'));
    prisma.db.pemesananBukuWilayah.push({ id: 'pw-1', sesiId: 'sesi-1', wilayahId: 'wil-1', status: 'DRAFT_WILAYAH', nomor: 'W1', ttdFileKey: 'ttd-lama' });
    await svc.submitCabang(A, 'sesi-1');
    const pw = prisma.db.pemesananBukuWilayah[0];
    assert.equal(pw.ttdFileKey, null, 'scan basi dilepas dari pesanan wilayah');
    assert.equal(pw.baFingerprint, null, 'cetakan lama tidak berlaku');
    assert.match(pw.resetAlasan, /Jambi An-Nafiah mengirim pesanan/);
    assert.equal(storage.files.has('ttd-lama'), false);
    prisma.db.pemesananBukuWilayah.splice(0, 1);

    prisma.db.pemesananBukuWilayah.push({ id: 'pw-2', sesiId: 'sesi-1', wilayahId: 'wil-1', status: 'SUBMITTED_WILAYAH', nomor: 'W2' });
    await assert.rejects(svc.submitCabang(userCabang('cab-b'), 'sesi-1'), /wilayah sudah dikunci/);
    assert.equal((await svc.getCabang(userCabang('cab-b'))).wilayahTerkunci, true);
  });

  it('buktiCabangPdf hanya setelah submit', async () => {
    const { svc } = buatService();
    await assert.rejects(svc.buktiCabangPdf(A), /setelah pesanan dikunci/);
    await svc.submitCabang(A, 'sesi-1');
    const { buffer, filename } = await svc.buktiCabangPdf(A);
    assert.equal(Buffer.from(buffer.slice(0, 5)).toString(), '%PDF-');
    assert.equal(filename, 'Bukti_Pesanan_Buku_Jambi_An-Nafiah_2026_2027_GANJIL.pdf');
  });

  it('nomor pesanan tidak bentrok bila kode cabang hanya beda huruf besar/kecil', async () => {
    const seed = seedDasar();
    seed.cabang.find((c: any) => c.id === 'cab-b')!.kode = 'jmb01'; // cab-a: 'JMB01'
    const { svc } = buatService(seed);
    const a = await svc.submitCabang(A, 'sesi-1');
    const b = await svc.submitCabang(userCabang('cab-b'), 'sesi-1');
    assert.equal(b.status, 'SUBMITTED_CABANG');
    assert.notEqual(a.nomor, b.nomor);
  });

  it('submit tidak 409 bila pesanan wilayah basi sudah dibersihkan proses lain', async () => {
    const { svc, prisma } = buatService();
    const pw = { id: 'pw-1', sesiId: 'sesi-1', wilayahId: 'wil-1', status: 'DRAFT_WILAYAH', nomor: 'W1', ttdFileKey: null, baFingerprint: 'X' };
    const asli = prisma.pemesananBukuWilayah.findUnique;
    prisma.pemesananBukuWilayah.findUnique = async () => ({ ...pw }); // dibaca sebelum proses lain mereset
    prisma.pemesananBukuWilayah.updateMany = async () => ({ count: 0 }); // proses lain sudah mereset duluan
    prisma.pemesananBukuWilayah.findUnique = async (args: any) => (args?.where?.id ? { ...pw, baFingerprint: null } : { ...pw });
    const v = await svc.submitCabang(A, 'sesi-1');
    assert.equal(v.status, 'SUBMITTED_CABANG');
    prisma.pemesananBukuWilayah.findUnique = asli;
  });

  it('akun WILAYAH tanpa wilayahId tidak bisa membaca cabang', async () => {
    const { svc } = buatService();
    await assert.rejects(svc.getCabang({ ...userWilayah('x'), wilayahId: null }, undefined, 'cab-x'), /Akses ditolak/);
  });
});
