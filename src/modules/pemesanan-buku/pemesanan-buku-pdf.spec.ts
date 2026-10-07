/**
 * Run with:
 *   npx tsx --test src/modules/pemesanan-buku/pemesanan-buku-pdf.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import { PemesananBukuPdfService, safeText, potongTeks, skalaGambar, type BeritaAcaraData } from './pemesanan-buku-pdf.service.js';
import { hitungPesanan } from './pemesanan-buku-hitung.js';

const svc = new PemesananBukuPdfService();
const items = hitungPesanan([
  { kelasId: 'a', name: '10A', tingkat: '10', jumlahSantri: 26 },
  { kelasId: 'b', name: '11A', tingkat: '11', jumlahSantri: 20 },
]).items;

function dataBa(jumlahCabang: number): BeritaAcaraData {
  return {
    wilayahName: 'Sumatera Bagian Selatan',
    sesiLabel: 'Semester Ganjil Tahun Ajaran 2026/2027',
    nomor: 'PBM/2026-2027/GANJIL/W/ABCDEF12',
    dicetakPada: new Date('2026-10-07T03:00:00Z'),
    rows: Array.from({ length: jumlahCabang }, (_, i) => ({
      cabangName: i === 0 ? 'Jambi An-Nafi’ah Şanlıurfa İstanbul dengan nama yang sangat panjang sekali' : `Cabang ${i + 1}`,
      items,
      total: 48,
    })),
  };
}

const halaman = async (buf: Uint8Array) => (await PDFDocument.load(buf)).getPageCount();

describe('safeText & potongTeks', () => {
  it('mentransliterasi karakter di luar WinAnsi', () => {
    assert.equal(safeText('Şanlıurfa İ ’x’ “y” – 😀'), "Sanliurfa I 'x' \"y\" - ");
  });

  it('tab/baris baru menjadi spasi; nama non-Latin tidak tampil kosong', () => {
    assert.equal(safeText('Tab\tBaris\nBaru'), 'Tab Baris Baru');
    assert.equal(safeText('مدرسة النور'), '(nama non-Latin)');
    assert.equal(safeText(''), '');
  });

  it('kata tunggal yang sangat panjang di paragraf tidak membuat error', async () => {
    const buf = await svc.beritaAcara({ ...dataBa(1), wilayahName: 'W'.repeat(300) });
    assert.equal(await halaman(buf), 1);
  });

  it('memotong teks agar muat di kolom', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const panjang = 'Nama Cabang Yang Sangat Panjang Sekali Melebihi Kolom';
    const hasil = potongTeks(panjang, font, 9, 80);
    assert.ok(hasil.endsWith('...'));
    assert.ok(font.widthOfTextAtSize(hasil, 9) <= 80);
    assert.equal(potongTeks('Pendek', font, 9, 80), 'Pendek');
  });

  it('skala gambar mengikuti sisi terbatas', () => {
    assert.deepEqual(skalaGambar(4000, 3000, 400, 600), { width: 400, height: 300 });
    assert.deepEqual(skalaGambar(100, 200, 400, 600), { width: 300, height: 600 });
  });
});

describe('PemesananBukuPdfService', () => {
  it('berita acara 7 cabang muat 1 halaman', async () => {
    const buf = await svc.beritaAcara(dataBa(7));
    assert.equal(Buffer.from(buf.slice(0, 5)).toString(), '%PDF-');
    assert.equal(await halaman(buf), 1);
  });

  it('berita acara 40 cabang berlanjut ke halaman berikutnya', async () => {
    assert.ok((await halaman(await svc.beritaAcara(dataBa(40)))) >= 2);
  });

  it('bukti cabang 1 halaman', async () => {
    const buf = await svc.buktiCabang({
      nomor: 'PBM/2026-2027/GANJIL/C/JMB01',
      cabangName: 'Jambi An-Nafi’ah',
      wilayahName: 'Sumbagsel',
      sesiLabel: 'Semester Ganjil Tahun Ajaran 2026/2027',
      status: 'Terkunci',
      submittedAt: new Date(),
      submittedByName: 'Operator Ş',
      items,
      dicetakPada: new Date(),
    });
    assert.equal(await halaman(buf), 1);
  });

  const final = (ttd: { buffer: Buffer; jenis: 'pdf' | 'png' | 'jpg' }) =>
    svc.finalWilayah({
      ...dataBa(3),
      submittedAt: new Date(),
      submittedByName: 'Admin Wilayah',
      cabang: [{ cabangName: 'Cabang 1', nomor: 'PBM/2026-2027/GANJIL/C/X1', submittedAt: new Date(), total: 48 }],
      ttd: { ...ttd, fileName: 'scan.ext', uploadedAt: new Date() },
    });

  it('final = berita acara + metadata + semua halaman scan PDF', async () => {
    const scan = await PDFDocument.create();
    scan.addPage();
    scan.addPage();
    const buf = await final({ buffer: Buffer.from(await scan.save()), jenis: 'pdf' });
    assert.equal(await halaman(buf), 1 + 1 + 2);
  });

  it('final dengan scan JPG dan PNG menambah satu halaman gambar', async () => {
    const jpg = await sharp({ create: { width: 1200, height: 1700, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    const png = await sharp({ create: { width: 1700, height: 1200, channels: 3, background: '#ffffff' } }).png().toBuffer();
    assert.equal(await halaman(await final({ buffer: jpg, jenis: 'jpg' })), 3);
    assert.equal(await halaman(await final({ buffer: png, jenis: 'png' })), 3);
  });
});
