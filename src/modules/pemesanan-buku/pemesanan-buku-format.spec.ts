/**
 * Run with:
 *   npx tsx --test src/modules/pemesanan-buku/pemesanan-buku-format.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSemester,
  tahunAjaranValid,
  labelSesi,
  nomorCabang,
  nomorWilayah,
  formatTanggal,
  formatWaktu,
  namaFileAman,
} from './pemesanan-buku-format.js';
import { deteksiJenisBerkas, decodeNamaBerkas } from './pemesanan-buku-file.js';

const sesi = { tahunAjaran: '2026/2027', semester: 'GANJIL' };

describe('normalizeSemester', () => {
  it('menyeragamkan ejaan semester', () => {
    assert.equal(normalizeSemester('Ganjil'), 'GANJIL');
    assert.equal(normalizeSemester(' genap '), 'GENAP');
    assert.equal(normalizeSemester('1'), 'GANJIL');
    assert.equal(normalizeSemester('2'), 'GENAP');
    assert.equal(normalizeSemester('Pendek'), null);
    assert.equal(normalizeSemester(undefined), null);
  });
});

describe('tahunAjaranValid', () => {
  it('format YYYY/YYYY dengan tahun berurutan', () => {
    assert.equal(tahunAjaranValid('2026/2027'), true);
    assert.equal(tahunAjaranValid('2026/2028'), false);
    assert.equal(tahunAjaranValid('2026-2027'), false);
    assert.equal(tahunAjaranValid(2026), false);
  });
});

describe('label & nomor', () => {
  it('label sesi untuk dokumen', () => {
    assert.equal(labelSesi(sesi), 'Semester Ganjil Tahun Ajaran 2026/2027');
    assert.equal(labelSesi({ ...sesi, semester: 'GENAP' }), 'Semester Genap Tahun Ajaran 2026/2027');
  });

  it('nomor cabang memakai kode, fallback 8 karakter id', () => {
    assert.equal(nomorCabang(sesi, { id: 'x', kode: 'jmb01' }), 'PBM/2026-2027/GANJIL/C/JMB01');
    assert.equal(nomorCabang(sesi, { id: '1a2b3c4d-9999', kode: null }), 'PBM/2026-2027/GANJIL/C/1A2B3C4D');
    assert.equal(nomorWilayah(sesi, 'abcdef12-3456'), 'PBM/2026-2027/GANJIL/W/ABCDEF12');
  });
});

describe('tanggal WIB', () => {
  it('memformat tanggal Indonesia dalam zona WIB', () => {
    // 2026-10-07 18:30 UTC = 8 Oktober 01:30 WIB
    const d = new Date('2026-10-07T18:30:00Z');
    assert.equal(formatTanggal(d), '8 Oktober 2026');
    assert.equal(formatWaktu(d), '8 Oktober 2026 01:30 WIB');
  });
});

describe('namaFileAman', () => {
  it('membuang karakter berbahaya untuk header Content-Disposition', () => {
    assert.equal(namaFileAman('Jambi An-Nafi\'ah / "Ş"'), 'Jambi_An-Nafi_ah_S');
    assert.equal(namaFileAman('///'), 'dokumen');
  });
});

describe('deteksiJenisBerkas', () => {
  const PDF = Buffer.from('%PDF-1.7\n...');
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);

  it('ekstensi dan magic bytes harus cocok', () => {
    assert.equal(deteksiJenisBerkas(PDF, 'scan.PDF'), 'pdf');
    assert.equal(deteksiJenisBerkas(PNG, 'foto.png'), 'png');
    assert.equal(deteksiJenisBerkas(JPG, 'foto.jpeg'), 'jpg');
    assert.equal(deteksiJenisBerkas(JPG, 'foto.jpg'), 'jpg');
  });

  it('menolak ekstensi lain atau isi yang tidak cocok', () => {
    assert.equal(deteksiJenisBerkas(PNG, 'scan.pdf'), null);
    assert.equal(deteksiJenisBerkas(PDF, 'scan.png'), null);
    assert.equal(deteksiJenisBerkas(PDF, 'scan.webp'), null);
    assert.equal(deteksiJenisBerkas(Buffer.alloc(0), 'scan.pdf'), null);
    assert.equal(deteksiJenisBerkas(PDF, 'tanpa-ekstensi'), null);
  });
});

describe('decodeNamaBerkas', () => {
  it('memperbaiki nama UTF-8 yang dibaca sebagai latin1 oleh multer', () => {
    const latin1 = Buffer.from('Berita Acara Şubat.pdf', 'utf8').toString('latin1');
    assert.equal(decodeNamaBerkas(latin1), 'Berita Acara Şubat.pdf');
    assert.equal(decodeNamaBerkas('scan.pdf'), 'scan.pdf');
  });
});
