import { Injectable } from '@nestjs/common';
import { PDFDocument, PDFFont, PDFPage, RGB, StandardFonts, rgb } from 'pdf-lib';
import { normalizeTurkish } from '../../common/utils/turkish-char.util.js';
import { TINGKAT_LIST, ringkas, type ItemRingkas } from './pemesanan-buku-hitung.js';
import { formatTanggal, formatWaktu } from './pemesanan-buku-format.js';
import type { JenisBerkas } from './pemesanan-buku-file.js';

export interface BarisBeritaAcara { cabangName: string; items: ItemRingkas[]; total: number; }
export interface BeritaAcaraData {
  wilayahName: string;
  sesiLabel: string;
  nomor: string;
  /** Sidik data pesanan; dicetak di footer agar scan bisa dicocokkan dengan cetakannya. */
  kode?: string;
  rows: BarisBeritaAcara[];
  dicetakPada: Date;
}
export interface BuktiCabangData {
  nomor: string; cabangName: string; wilayahName: string; sesiLabel: string; status: string;
  submittedAt: Date | null; submittedByName: string | null; items: ItemRingkas[]; dicetakPada: Date;
}
export interface FinalWilayahData extends BeritaAcaraData {
  submittedAt: Date;
  submittedByName: string | null;
  cabang: { cabangName: string; nomor: string; submittedAt: Date | null; total: number }[];
  ttd: { buffer: Buffer; jenis: JenisBerkas; fileName: string; uploadedAt: Date | null };
}

const A4: [number, number] = [595.28, 841.89];
const M = 50;
const LEBAR = A4[0] - 2 * M;
const NAVY = rgb(31 / 255, 56 / 255, 100 / 255);
const TEKS = rgb(0.13, 0.15, 0.18);
const MUTED = rgb(0.42, 0.45, 0.5);
const GARIS = rgb(0.86, 0.87, 0.89);
const ZEBRA = rgb(0.97, 0.975, 0.98);
const ABU = rgb(0.9, 0.91, 0.93);
const PUTIH = rgb(1, 1, 1);
const KETERANGAN =
  '*Keterangan: Jumlah buku yang dipesan sudah termasuk buku kebutuhan Guru (1 buku guru untuk maksimal 30 santri/siswa).';

/** Font standar PDF hanya mendukung WinAnsi: transliterasi huruf Turki & tanda kutip, buang sisanya. */
export function safeText(input: string | null | undefined): string {
  const asli = String(input ?? '');
  const hasil = normalizeTurkish(asli)
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '');
  // Nama yang seluruhnya aksara non-Latin (Arab, Kiril, ...) tidak bisa dicetak dengan font standar.
  return hasil.trim() === '' && asli.trim() !== '' ? '(nama non-Latin)' : hasil;
}

export function potongTeks(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && font.widthOfTextAtSize(`${t.trimEnd()}...`, size) > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}...`;
}

export function skalaGambar(w: number, h: number, maxW: number, maxH: number) {
  const k = Math.min(maxW / w, maxH / h);
  return { width: w * k, height: h * k };
}

function bungkus(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const kata of safeText(text).split(/\s+/).filter(Boolean)) {
    const w = potongTeks(kata, font, size, maxWidth);
    const coba = cur ? `${cur} ${w}` : w;
    if (!cur || font.widthOfTextAtSize(coba, size) <= maxWidth) cur = coba;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

interface Fonts { reg: PDFFont; bold: PDFFont; italic: PDFFont; }

class Kanvas {
  page!: PDFPage;
  y = 0;
  constructor(readonly doc: PDFDocument, readonly f: Fonts, private readonly footer: string) {
    this.halamanBaru();
  }
  halamanBaru() {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - M;
    this.page.drawText(safeText(this.footer), { x: M, y: 28, size: 7.5, font: this.f.reg, color: MUTED });
  }
  /** Pindah halaman bila sisa ruang < tinggi. Mengembalikan true bila halaman baru dibuat. */
  pastikan(tinggi: number): boolean {
    if (this.y - (M + 10) < tinggi) { this.halamanBaru(); return true; }
    return false;
  }
  teks(text: string, x: number, size: number, font = this.f.reg, color: RGB = TEKS) {
    this.page.drawText(safeText(text), { x, y: this.y, size, font, color });
  }
  tengah(text: string, size: number, font: PDFFont, color: RGB = TEKS, x0 = M, w = LEBAR) {
    const t = safeText(text);
    this.page.drawText(t, { x: x0 + (w - font.widthOfTextAtSize(t, size)) / 2, y: this.y, size, font, color });
  }
  kanan(text: string, size: number, font: PDFFont, color: RGB = TEKS) {
    const t = safeText(text);
    this.page.drawText(t, { x: M + LEBAR - font.widthOfTextAtSize(t, size), y: this.y, size, font, color });
  }
}

interface Kolom { judul: string[]; lebar: number; rata: 'kiri' | 'tengah' | 'kanan'; }

const posisiX = (c: Kolom, x: number, tw: number) =>
  c.rata === 'kiri' ? x + 6 : c.rata === 'kanan' ? x + c.lebar - 6 - tw : x + (c.lebar - tw) / 2;

function tabel(k: Kanvas, kolom: Kolom[], baris: string[][], barisTotal?: string[], tinggiBaris = 24) {
  const tinggiHeader = Math.max(...kolom.map((c) => c.judul.length)) * 11 + 14;
  const header = () => {
    k.pastikan(tinggiHeader + tinggiBaris);
    k.page.drawRectangle({ x: M, y: k.y - tinggiHeader, width: LEBAR, height: tinggiHeader, color: NAVY });
    let x = M;
    for (const c of kolom) {
      const pad = (tinggiHeader - c.judul.length * 11) / 2;
      c.judul.forEach((line, i) => {
        const t = safeText(line);
        const tw = k.f.bold.widthOfTextAtSize(t, 8.5);
        k.page.drawText(t, { x: posisiX(c, x, tw), y: k.y - pad - 8.5 - i * 11, size: 8.5, font: k.f.bold, color: PUTIH });
      });
      x += c.lebar;
    }
    k.y -= tinggiHeader;
  };
  const sel = (cells: string[], bg: RGB | null, tebal: boolean) => {
    if (bg) k.page.drawRectangle({ x: M, y: k.y - tinggiBaris, width: LEBAR, height: tinggiBaris, color: bg });
    let x = M;
    cells.forEach((cell, idx) => {
      const c = kolom[idx];
      const font = tebal ? k.f.bold : k.f.reg;
      const t = potongTeks(safeText(cell), font, 9, c.lebar - 10);
      k.page.drawText(t, { x: posisiX(c, x, font.widthOfTextAtSize(t, 9)), y: k.y - tinggiBaris / 2 - 3, size: 9, font, color: tebal ? NAVY : TEKS });
      if (idx > 0) k.page.drawLine({ start: { x, y: k.y }, end: { x, y: k.y - tinggiBaris }, thickness: 0.5, color: GARIS });
      x += c.lebar;
    });
    k.page.drawLine({ start: { x: M, y: k.y - tinggiBaris }, end: { x: M + LEBAR, y: k.y - tinggiBaris }, thickness: 0.5, color: GARIS });
    k.y -= tinggiBaris;
  };
  header();
  baris.forEach((cells, i) => {
    if (k.pastikan(tinggiBaris)) header();
    sel(cells, i % 2 === 1 ? ZEBRA : null, false);
  });
  if (barisTotal) {
    if (k.pastikan(tinggiBaris)) header();
    sel(barisTotal, ABU, true);
  }
}

/** Paragraf dengan segmen tebal, dibungkus per kata. */
function paragrafKaya(k: Kanvas, segmen: { text: string; bold?: boolean }[], size: number, lineHeight: number) {
  const tokens = segmen.flatMap((s) =>
    safeText(s.text).split(/(\s+)/).filter((t) => t.length > 0).map((t) => ({ t, bold: !!s.bold })),
  );
  let x = M;
  for (const tok of tokens) {
    const font = tok.bold ? k.f.bold : k.f.reg;
    const spasi = /^\s+$/.test(tok.t);
    if (spasi && x === M) continue;
    const text = spasi ? ' ' : potongTeks(tok.t, font, size, LEBAR);
    const w = font.widthOfTextAtSize(text, size);
    if (!spasi && x > M && x + w > M + LEBAR) { k.y -= lineHeight; x = M; }
    k.page.drawText(text, { x, y: k.y, size, font, color: TEKS });
    x += w;
  }
  k.y -= lineHeight;
}

function infoBaris(k: Kanvas, pasangan: [string, string][]) {
  for (const [label, nilai] of pasangan) {
    k.pastikan(16);
    k.teks(label, M, 9.5, k.f.bold, MUTED);
    k.teks(`: ${potongTeks(safeText(nilai), k.f.reg, 9.5, LEBAR - 130)}`, M + 120, 9.5);
    k.y -= 16;
  }
}

const totalTingkat = (items: ItemRingkas[], t: number) => items.find((i) => i.tingkat === t)?.total ?? 0;
const kosongkanNol = (n: number) => (n > 0 ? String(n) : '');

function gambarBeritaAcara(doc: PDFDocument, f: Fonts, d: BeritaAcaraData) {
  const k = new Kanvas(doc, f, `${d.nomor}${d.kode ? `  -  Kode ${d.kode}` : ''}  -  Dicetak ${formatWaktu(d.dicetakPada)}`);
  k.y -= 20;
  k.tengah('BERITA ACARA', 18, f.bold, NAVY);
  k.y -= 22;
  k.tengah('PEMESANAN BUKU MUADALAH', 14, f.bold, NAVY);
  k.y -= 40;
  paragrafKaya(
    k,
    [
      { text: 'Berikut disampaikan jumlah pemesanan buku Pelajaran Mapel Umum yang akan digunakan oleh para santri di wilayah ' },
      { text: d.wilayahName, bold: true },
      { text: ' pada ' },
      { text: d.sesiLabel, bold: true },
      { text: ' :' },
    ],
    10.5,
    15,
  );
  k.y -= 12;
  const kolom: Kolom[] = [
    { judul: ['NO'], lebar: 30, rata: 'tengah' },
    { judul: ['NAMA MITRA/CABANG'], lebar: LEBAR - 30 - 6 * 44 - 50, rata: 'kiri' },
    ...TINGKAT_LIST.map((t) => ({ judul: ['KELAS', String(t)], lebar: 44, rata: 'tengah' as const })),
    { judul: ['TOTAL'], lebar: 50, rata: 'tengah' },
  ];
  const baris = d.rows.map((r, i) => [
    String(i + 1),
    r.cabangName,
    ...TINGKAT_LIST.map((t) => kosongkanNol(totalTingkat(r.items, t))),
    kosongkanNol(r.total),
  ]);
  const totalPer = TINGKAT_LIST.map((t) => d.rows.reduce((s, r) => s + totalTingkat(r.items, t), 0));
  const grand = d.rows.reduce((s, r) => s + r.total, 0);
  tabel(k, kolom, baris, ['', 'TOTAL', ...totalPer.map(String), String(grand)], 26);

  // Keterangan + tanggal + 3 kolom tanda tangan butuh ±200pt; pindah halaman bila tidak muat.
  k.y -= 16;
  k.pastikan(200);
  for (const line of bungkus(KETERANGAN, f.italic, 8.5, LEBAR)) {
    k.teks(line, M, 8.5, f.italic, MUTED);
    k.y -= 12;
  }
  k.y -= 24;
  k.kanan(formatTanggal(d.dicetakPada), 10, f.bold);
  k.y -= 36;
  const lebarKol = LEBAR / 3;
  const jabatan = [
    ['Penanggung Jawab Keuangan', 'Wilayah,'],
    ['Penanggung Jawab Muadalah', 'Wilayah,'],
    ['Penanggung Jawab Divisi Legal', 'Wilayah,'],
  ];
  const yAwal = k.y;
  jabatan.forEach((baris2, i) => {
    k.y = yAwal;
    for (const l of baris2) {
      k.tengah(l, 9.5, f.bold, TEKS, M + i * lebarKol, lebarKol);
      k.y -= 13;
    }
    k.y -= 60;
    k.tengah('( .................................... )', 9, f.reg, MUTED, M + i * lebarKol, lebarKol);
  });
  k.y -= 20;
}

@Injectable()
export class PemesananBukuPdfService {
  private async dokumenBaru(judul: string): Promise<{ doc: PDFDocument; f: Fonts }> {
    const doc = await PDFDocument.create();
    doc.setTitle(safeText(judul));
    doc.setCreator('eSantri');
    const f: Fonts = {
      reg: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
      italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    };
    return { doc, f };
  }

  async beritaAcara(d: BeritaAcaraData): Promise<Uint8Array> {
    const { doc, f } = await this.dokumenBaru(`Berita Acara Pemesanan Buku ${d.nomor}`);
    gambarBeritaAcara(doc, f, d);
    return doc.save();
  }

  async buktiCabang(d: BuktiCabangData): Promise<Uint8Array> {
    const { doc, f } = await this.dokumenBaru(`Bukti Pemesanan Buku ${d.nomor}`);
    const k = new Kanvas(doc, f, `${d.nomor}  -  Diunduh ${formatWaktu(d.dicetakPada)}`);
    k.y -= 20;
    k.tengah('BUKTI PEMESANAN BUKU MUADALAH', 16, f.bold, NAVY);
    k.y -= 20;
    k.tengah(d.sesiLabel, 11, f.reg, MUTED);
    k.y -= 36;
    infoBaris(k, [
      ['Nomor Pesanan', d.nomor],
      ['Cabang', d.cabangName],
      ['Wilayah', d.wilayahName],
      ['Status', d.status],
      ['Waktu Pesan', d.submittedAt ? formatWaktu(d.submittedAt) : '-'],
      ['Dipesan oleh', d.submittedByName || '-'],
    ]);
    k.y -= 16;
    const lebarAngka = (LEBAR - 155) / 3;
    const kolom: Kolom[] = [
      { judul: ['KELAS'], lebar: 155, rata: 'kiri' },
      { judul: ['JUMLAH SANTRI'], lebar: lebarAngka, rata: 'tengah' },
      { judul: ['BUKU GURU'], lebar: lebarAngka, rata: 'tengah' },
      { judul: ['TOTAL BUKU'], lebar: lebarAngka, rata: 'tengah' },
    ];
    const baris = TINGKAT_LIST.map((t) => {
      const i = d.items.find((x) => x.tingkat === t) ?? { tingkat: t, jumlahSantri: 0, jumlahGuru: 0, total: 0 };
      return [`Kelas ${t}`, String(i.jumlahSantri), String(i.jumlahGuru), String(i.total)];
    });
    const r = ringkas(d.items);
    tabel(k, kolom, baris, ['TOTAL', String(r.totalSantri), String(r.totalGuru), String(r.grandTotal)]);
    k.y -= 16;
    for (const line of bungkus(KETERANGAN, f.italic, 8.5, LEBAR)) {
      k.teks(line, M, 8.5, f.italic, MUTED);
      k.y -= 12;
    }
    return doc.save();
  }

  async finalWilayah(d: FinalWilayahData): Promise<Uint8Array> {
    const { doc, f } = await this.dokumenBaru(`Pesanan Final Buku ${d.nomor}`);
    gambarBeritaAcara(doc, f, d);

    const k = new Kanvas(doc, f, `${d.nomor}  -  Diunduh ${formatWaktu(d.dicetakPada)}`);
    k.y -= 10;
    k.tengah('LAMPIRAN - DATA PESANAN WILAYAH', 14, f.bold, NAVY);
    k.y -= 32;
    infoBaris(k, [
      ['Nomor Pesanan', d.nomor],
      ['Wilayah', d.wilayahName],
      ['Sesi', d.sesiLabel],
      ['Waktu Pesan', formatWaktu(d.submittedAt)],
      ['Dipesan oleh', d.submittedByName || '-'],
      ['Berkas TTD', d.ttd.fileName],
      ['Diunggah', d.ttd.uploadedAt ? formatWaktu(d.ttd.uploadedAt) : '-'],
      ['Total Buku', String(d.rows.reduce((s, r) => s + r.total, 0))],
    ]);
    k.y -= 12;
    tabel(
      k,
      [
        { judul: ['NO'], lebar: 30, rata: 'tengah' },
        { judul: ['CABANG'], lebar: LEBAR - 30 - 165 - 100 - 55, rata: 'kiri' },
        { judul: ['NOMOR PESANAN'], lebar: 165, rata: 'kiri' },
        { judul: ['TANGGAL PESAN'], lebar: 100, rata: 'tengah' },
        { judul: ['TOTAL'], lebar: 55, rata: 'tengah' },
      ],
      d.cabang.map((c, i) => [String(i + 1), c.cabangName, c.nomor, c.submittedAt ? formatTanggal(c.submittedAt) : '-', String(c.total)]),
    );

    if (d.ttd.jenis === 'pdf') {
      const src = await PDFDocument.load(d.ttd.buffer);
      const pages = await doc.copyPages(src, src.getPageIndices());
      pages.forEach((p) => doc.addPage(p));
    } else {
      const img = d.ttd.jenis === 'png' ? await doc.embedPng(d.ttd.buffer) : await doc.embedJpg(d.ttd.buffer);
      const page = doc.addPage(A4);
      const { width, height } = skalaGambar(img.width, img.height, A4[0] - 60, A4[1] - 60);
      page.drawImage(img, { x: (A4[0] - width) / 2, y: (A4[1] - height) / 2, width, height });
    }
    return doc.save();
  }
}
