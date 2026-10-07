/**
 * Run with:
 *   npx tsx --test src/modules/pemesanan-buku/pemesanan-buku-wilayah.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { buatService, seedDasar, userCabang, userWilayah, userGlobal } from './pemesanan-buku.fixture.js';

const W1 = userWilayah('wil-1');
const file = (buffer: Buffer, originalname: string) => ({ buffer, originalname, size: buffer.length }) as any;
const png = () => sharp({ create: { width: 60, height: 80, channels: 3, background: '#fff' } }).png().toBuffer();

async function siapCetak() {
  const ctx = buatService();
  await ctx.svc.submitCabang(userCabang('cab-a'), 'sesi-1');
  await ctx.svc.submitCabang(userCabang('cab-b'), 'sesi-1');
  await ctx.svc.beritaAcaraPdf(W1); // wilayah mencetak BA sebelum upload scan
  return ctx;
}

describe('PemesananBukuService — wilayah', () => {
  it('getWilayah: status per cabang, pending, dan cabang tanpa santri tidak memblokir', async () => {
    const { svc } = buatService();
    const v = await svc.getWilayah(W1);
    assert.deepEqual(v.rows.map((r) => [r.cabangName, r.status]), [
      ['Cabang Kosong', 'TIDAK_ADA_SANTRI'],
      ['Jambi An-Nafiah', 'BELUM'],
      ['Kalianda', 'BELUM'],
    ]);
    assert.deepEqual(v.pendingCabang, ['Jambi An-Nafiah', 'Kalianda']);
    assert.equal(v.siapCetak, false);
    assert.equal(v.status, 'BELUM');
    await assert.rejects(svc.beritaAcaraPdf(W1), /belum memesan: Jambi An-Nafiah, Kalianda/);
  });

  it('setelah semua cabang submit: siap cetak, total benar, berita acara PDF', async () => {
    const { svc } = await siapCetak();
    const v = await svc.getWilayah(W1);
    assert.equal(v.siapCetak, true);
    assert.equal(v.grandTotal, 48 + 31);
    assert.equal(v.totalPerTingkat.find((t) => t.tingkat === 8)!.total, 31);
    const { buffer, filename } = await svc.beritaAcaraPdf(W1);
    assert.equal(Buffer.from(buffer.slice(0, 5)).toString(), '%PDF-');
    assert.match(filename, /^Berita_Acara_Pemesanan_Buku_Sumbagsel_2026_2027_GANJIL\.pdf$/);
  });

  it('upload TTD: validasi format, isi, ukuran, PDF rusak, dan prasyarat siap cetak', async () => {
    const belum = buatService();
    await assert.rejects(belum.svc.uploadTtd(W1, 'sesi-1', file(await png(), 'scan.png')), /belum memesan/);

    const { svc } = await siapCetak();
    await assert.rejects(svc.uploadTtd(W1, 'sesi-1', undefined), /wajib diunggah/);
    await assert.rejects(svc.uploadTtd(W1, 'sesi-1', file(Buffer.from('GIF89a'), 'scan.gif')), /PDF, JPG, atau PNG/);
    await assert.rejects(svc.uploadTtd(W1, 'sesi-1', file(await png(), 'scan.pdf')), /PDF, JPG, atau PNG/);
    await assert.rejects(svc.uploadTtd(W1, 'sesi-1', file(Buffer.from('%PDF-1.4 rusak'), 'scan.pdf')), /tidak dapat dibaca/);
    const besar = Buffer.alloc(10 * 1024 * 1024 + 1);
    await assert.rejects(svc.uploadTtd(W1, 'sesi-1', { buffer: besar, originalname: 'a.pdf', size: besar.length } as any), /maksimal 10 MB/);
    await assert.rejects(svc.uploadTtd(userCabang('cab-a') as any, 'sesi-1', file(await png(), 'scan.png')), /hanya untuk akun Wilayah/);
  });

  it('upload → draft → submit → PDF final; ganti scan menghapus berkas lama', async () => {
    const { svc, storage } = await siapCetak();
    await assert.rejects(svc.simpanDraftWilayah(W1, 'sesi-1'), /Unggah scan/);

    let v = await svc.uploadTtd(W1, 'sesi-1', file(await png(), 'scan.png'));
    assert.equal(v.status, 'DRAFT_WILAYAH');
    assert.equal(v.draftAt, null);
    assert.equal(v.ttd?.fileName, 'scan.png');
    assert.equal(storage.files.size, 1);
    const keyLama = [...storage.files.keys()][0];
    assert.match(keyLama, /^pemesanan-buku\/ttd\/sesi-1\/wil-1_\d+_[0-9a-f]{6}\.png$/);

    const scanPdf = await PDFDocument.create();
    scanPdf.addPage();
    scanPdf.addPage();
    v = await svc.uploadTtd(W1, 'sesi-1', file(Buffer.from(await scanPdf.save()), 'Berita Acara.pdf'));
    assert.equal(storage.files.size, 1);
    assert.equal(storage.files.has(keyLama), false);

    v = await svc.simpanDraftWilayah(W1, 'sesi-1');
    assert.ok(v.draftAt instanceof Date);

    v = await svc.submitWilayah(W1, 'sesi-1');
    assert.equal(v.status, 'SUBMITTED_WILAYAH');
    assert.equal(v.submittedByName, 'Admin wil-1');
    await assert.rejects(svc.uploadTtd(W1, 'sesi-1', file(await png(), 'scan.png')), /wilayah sudah dikunci/);

    const { buffer } = await svc.finalPdf(W1);
    assert.equal((await PDFDocument.load(buffer)).getPageCount(), 1 + 1 + 2);
    const ttd = await svc.ambilTtd(userGlobal, undefined, 'wil-1');
    assert.equal(ttd.mime, 'application/pdf');
  });

  it('submit wilayah ditolak bila ada cabang baru yang menjadi eligible', async () => {
    const { svc, live } = await siapCetak();
    await svc.uploadTtd(W1, 'sesi-1', file(await png(), 'scan.png'));
    live['cab-c'] = [{ kelasId: 'k9', name: '7A', tingkat: '7', jumlahSantri: 4 }];
    await assert.rejects(svc.submitWilayah(W1, 'sesi-1'), /belum memesan: Cabang Kosong/);
  });

  it('cabang pindah wilayah setelah submit tetap terhitung di wilayah lama', async () => {
    const { svc, prisma } = await siapCetak();
    prisma.db.cabang.find((c: any) => c.id === 'cab-a').wilayahId = 'wil-2';
    const v1 = await svc.getWilayah(W1);
    assert.ok(v1.rows.some((r) => r.cabangId === 'cab-a' && r.status === 'SUBMITTED_CABANG'));
    const v2 = await svc.getWilayah(userWilayah('wil-2'));
    assert.equal(v2.rows.some((r) => r.cabangId === 'cab-a'), false);
  });

  it('scope wilayah: wilayah lain 403, GLOBAL wajib wilayahId', async () => {
    const { svc } = buatService();
    await assert.rejects(svc.getWilayah(W1, undefined, 'wil-2'), /Akses ditolak/);
    await assert.rejects(svc.getWilayah(userGlobal), /wilayahId wajib/);
    assert.equal((await svc.getWilayah(userGlobal, undefined, 'wil-2')).wilayah.name, 'Jawa Barat');
  });

  it('unlock: cabang ditolak bila wilayah terkunci; urutan wilayah → cabang menghapus scan', async () => {
    const { svc, prisma, storage } = await siapCetak();
    await svc.uploadTtd(W1, 'sesi-1', file(await png(), 'scan.png'));
    await svc.submitWilayah(W1, 'sesi-1');
    const pa = prisma.db.pemesananBukuCabang.find((p: any) => p.cabangId === 'cab-a');
    const pw = prisma.db.pemesananBukuWilayah[0];

    await assert.rejects(svc.unlockCabang(pa.id), /Buka kunci pesanan wilayah terlebih dahulu/);
    assert.deepEqual(await svc.unlockWilayah(pw.id), { success: true });
    assert.equal(prisma.db.pemesananBukuWilayah[0].status, 'DRAFT_WILAYAH');
    await assert.rejects(svc.unlockWilayah(pw.id), /tidak dalam status terkunci/);

    assert.deepEqual(await svc.unlockCabang(pa.id), { success: true });
    assert.equal(prisma.db.pemesananBukuCabang.find((p: any) => p.id === pa.id).status, 'DRAFT_CABANG');
    assert.equal(prisma.db.pemesananBukuWilayah[0].ttdFileKey, null);
    assert.equal(storage.files.size, 0);
    const v = await svc.getWilayah(W1);
    assert.equal(v.status, 'BELUM');
    assert.match(v.pemberitahuan?.alasan ?? '', /Admin membuka kunci pesanan cabang Jambi An-Nafiah/);
    await assert.rejects(svc.unlockCabang(pa.id), /tidak dalam status terkunci/);
    await svc.submitCabang(userCabang('cab-a'), 'sesi-1'); // cabang memesan kembali
    await svc.beritaAcaraPdf(W1);
    assert.equal((await svc.getWilayah(W1)).pemberitahuan, null, 'cetak ulang menghapus pemberitahuan');
  });

  it('rekap nasional: semua wilayah aktif dengan total', async () => {
    const { svc } = await siapCetak();
    const r = await svc.getRekap();
    assert.deepEqual(r.wilayah.map((w) => [w.wilayahName, w.siapCetak]), [['Jawa Barat', false], ['Sumbagsel', true]]);
    assert.equal(r.grandTotal, 79 + 13, 'Sumbagsel 79 + Bandung (IX: 12 santri + 1 guru)');
  });

  it('upload ditolak bila data berubah sejak Berita Acara dicetak (cetak ulang wajib)', async () => {
    const { svc, live, prisma } = await siapCetak();
    // cab-c baru punya santri dan memesan setelah BA dicetak
    live['cab-c'] = [{ kelasId: 'k9', name: '7A', tingkat: '7', jumlahSantri: 4 }];
    await svc.submitCabang(userCabang('cab-c'), 'sesi-1');
    // submit cab-c membuang catatan cetakan lama → wilayah wajib cetak lagi
    await assert.rejects(svc.uploadTtd(W1, 'sesi-1', file(await png(), 'scan.png')), /Cetak Berita Acara terlebih dahulu/);
    await svc.beritaAcaraPdf(W1);
    // sidik cetakan yang tidak cocok dengan data saat ini juga ditolak
    const row = prisma.db.pemesananBukuWilayah[0];
    const asli = row.baFingerprint;
    row.baFingerprint = 'BASI';
    await assert.rejects(svc.uploadTtd(W1, 'sesi-1', file(await png(), 'scan.png')), /Cetak ulang Berita Acara/);
    row.baFingerprint = asli;
    const v = await svc.uploadTtd(W1, 'sesi-1', file(await png(), 'scan.png'));
    assert.equal(v.ttd?.fileName, 'scan.png');
  });

  it('upload ditolak bila Berita Acara belum pernah dicetak oleh wilayah', async () => {
    const { svc } = buatService();
    await svc.submitCabang(userCabang('cab-a'), 'sesi-1');
    await svc.submitCabang(userCabang('cab-b'), 'sesi-1');
    await svc.beritaAcaraPdf(userGlobal, undefined, 'wil-1'); // cetakan admin tidak dihitung
    await assert.rejects(svc.uploadTtd(W1, 'sesi-1', file(await png(), 'scan.png')), /Cetak Berita Acara terlebih dahulu/);
    const v = await svc.getWilayah(W1);
    assert.equal(v.status, 'BELUM');
  });

  it('gambar scan rusak (magic bytes valid, isi rusak) ditolak saat upload', async () => {
    const { svc } = await siapCetak();
    const pngRusak = Buffer.concat([(await png()).subarray(0, 8), Buffer.from('rusak sekali')]);
    const jpgRusak = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x01, 0x02]);
    await assert.rejects(svc.uploadTtd(W1, 'sesi-1', file(pngRusak, 'scan.png')), /tidak dapat dibaca/);
    await assert.rejects(svc.uploadTtd(W1, 'sesi-1', file(jpgRusak, 'scan.jpg')), /tidak dapat dibaca/);
  });

  it('total wilayah terkunci tidak ikut berubah oleh cabang yang baru eligible', async () => {
    const { svc, live } = await siapCetak();
    await svc.uploadTtd(W1, 'sesi-1', file(await png(), 'scan.png'));
    await svc.submitWilayah(W1, 'sesi-1');
    live['cab-c'] = [{ kelasId: 'k9', name: '7A', tingkat: '7', jumlahSantri: 40 }];
    const v = await svc.getWilayah(W1);
    assert.equal(v.grandTotal, 79);
    assert.equal(v.siapCetak, true);
    assert.deepEqual(v.pendingCabang, []);
    const r = await svc.getRekap();
    assert.equal(r.wilayah.find((w) => w.wilayahId === 'wil-1')!.grandTotal, 79);
    await svc.beritaAcaraPdf(W1); // BA wilayah terkunci tetap bisa dicetak
  });

  it('upload tanpa sesiId ditolak', async () => {
    const { svc } = await siapCetak();
    await assert.rejects(svc.uploadTtd(W1, '', file(await png(), 'scan.png')), /sesiId wajib/);
  });

  it('dua upload pengganti bersamaan tidak meninggalkan berkas yatim', async () => {
    const { svc, prisma, storage } = await siapCetak();
    await svc.uploadTtd(W1, 'sesi-1', file(await png(), 'scan-1.png'));
    const basi = { ...prisma.db.pemesananBukuWilayah[0] }; // dibaca request B
    await svc.uploadTtd(W1, 'sesi-1', file(await png(), 'scan-2.png')); // request A selesai duluan
    const asli = prisma.pemesananBukuWilayah.findMany;
    prisma.pemesananBukuWilayah.findMany = async () => [{ ...basi }];
    await assert.rejects(svc.uploadTtd(W1, 'sesi-1', file(await png(), 'scan-3.png')), (e: any) => e.status === 409);
    prisma.pemesananBukuWilayah.findMany = asli;
    assert.equal(storage.files.size, 1, 'hanya berkas yang tercatat yang tersisa');
    assert.equal(storage.files.has(prisma.db.pemesananBukuWilayah[0].ttdFileKey), true);
  });

  it('rekap nasional memuat data dengan jumlah query tetap, bukan per wilayah', async () => {
    const seed = seedDasar();
    for (let i = 3; i <= 8; i++) {
      seed.wilayah.push({ id: `wil-${i}`, name: `Wilayah ${i}`, isActive: true });
      seed.cabang.push({ id: `cab-w${i}`, name: `Cabang W${i}`, kode: `W${i}`, wilayahId: `wil-${i}`, isActive: true });
    }
    const { svc, prisma } = buatService(seed);
    let panggil = 0;
    const asli = prisma.cabang.findMany;
    prisma.cabang.findMany = async (args: any) => (panggil++, asli(args));
    let live = 0;
    const liveAsli = (svc as any).hitungLive;
    (svc as any).hitungLive = async (ids: string[]) => (live++, liveAsli(ids));
    const r = await svc.getRekap();
    assert.equal(r.wilayah.length, 8);
    assert.equal(panggil, 1, 'cabang dimuat sekali untuk semua wilayah');
    assert.equal(live, 1, 'angka live dihitung sekali untuk semua cabang');
  });
});
