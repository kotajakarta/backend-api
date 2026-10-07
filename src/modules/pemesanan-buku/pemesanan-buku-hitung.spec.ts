/**
 * Run with:
 *   npx tsx --test src/modules/pemesanan-buku/pemesanan-buku-hitung.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTingkat,
  hitungGuru,
  hitungPesanan,
  kelompokkanRombel,
  samaItems,
  ringkas,
} from './pemesanan-buku-hitung.js';

describe('parseTingkat', () => {
  it('menerima angka dan Romawi 7–12 secara exact', () => {
    assert.equal(parseTingkat('7'), 7);
    assert.equal(parseTingkat(' 7 '), 7);
    assert.equal(parseTingkat('VII'), 7);
    assert.equal(parseTingkat('vii'), 7);
    assert.equal(parseTingkat('VIII'), 8);
    assert.equal(parseTingkat('IX'), 9, 'IX harus 9, bukan 10');
    assert.equal(parseTingkat('X'), 10);
    assert.equal(parseTingkat('XI'), 11);
    assert.equal(parseTingkat('XII'), 12);
    assert.equal(parseTingkat('12'), 12);
  });

  it('menolak nilai di luar 7–12 atau tidak dikenali', () => {
    for (const v of ['', '   ', null, undefined, '6', '13', 'X IPA', '10A', 'abc']) {
      assert.equal(parseTingkat(v as any), null, `nilai ${String(v)}`);
    }
  });
});

describe('hitungGuru', () => {
  it('1 buku guru per maksimal 30 santri', () => {
    assert.deepEqual([0, 1, 30, 31, 60, 61].map(hitungGuru), [0, 1, 1, 2, 2, 3]);
  });
});

describe('hitungPesanan', () => {
  it('menjumlah rombel satu tingkat lalu menghitung guru per tingkat, bukan per rombel', () => {
    const hasil = hitungPesanan([
      { kelasId: 'a', name: '7B', tingkat: '7', jumlahSantri: 20 },
      { kelasId: 'b', name: '7A', tingkat: 'VII', jumlahSantri: 20 },
    ]);
    const k7 = hasil.items.find((i) => i.tingkat === 7)!;
    assert.equal(k7.jumlahSantri, 40);
    assert.equal(k7.jumlahGuru, 2, 'ceil(40/30) = 2, bukan 1+1 per rombel');
    assert.equal(k7.total, 42);
    assert.deepEqual(k7.rombel, ['7A', '7B']);
  });

  it('selalu mengembalikan 6 item urut 7..12 dan total ringkasan', () => {
    const hasil = hitungPesanan([{ kelasId: 'a', name: '10A', tingkat: '10', jumlahSantri: 26 }]);
    assert.deepEqual(hasil.items.map((i) => i.tingkat), [7, 8, 9, 10, 11, 12]);
    assert.equal(hasil.totalSantri, 26);
    assert.equal(hasil.totalGuru, 1);
    assert.equal(hasil.grandTotal, 27);
  });

  it('memisahkan rombel bertingkat tidak dikenali yang berisi santri', () => {
    const hasil = hitungPesanan([
      { kelasId: 'a', name: 'Kelas Persiapan', tingkat: '', jumlahSantri: 5 },
      { kelasId: 'b', name: 'Kosong', tingkat: null, jumlahSantri: 0 },
      { kelasId: 'c', name: '8A', tingkat: '8', jumlahSantri: 3 },
    ]);
    assert.deepEqual(hasil.rombelBermasalah, [{ kelasId: 'a', name: 'Kelas Persiapan', tingkat: '', jumlahSantri: 5 }]);
    assert.equal(hasil.totalSantri, 3);
  });
});

describe('kelompokkanRombel', () => {
  it('mengelompokkan rombel per cabang dengan jumlah santri per kelas; kelas tanpa santri bernilai 0', () => {
    const map = kelompokkanRombel(
      [
        { id: 'k1', name: '7A', tingkat: '7', cabangId: 'cab-a' },
        { id: 'k2', name: '8A', tingkat: '8', cabangId: 'cab-b' },
        { id: 'k3', name: '9A', tingkat: '9', cabangId: 'cab-b' },
        { id: 'k4', name: 'Tanpa Cabang', tingkat: '9', cabangId: null },
      ],
      new Map([['k1', 2], ['k2', 1]]),
    );
    assert.deepEqual(map.get('cab-a'), [{ kelasId: 'k1', name: '7A', tingkat: '7', jumlahSantri: 2 }]);
    assert.deepEqual(map.get('cab-b'), [
      { kelasId: 'k2', name: '8A', tingkat: '8', jumlahSantri: 1 },
      { kelasId: 'k3', name: '9A', tingkat: '9', jumlahSantri: 0 },
    ]);
    assert.equal(map.size, 2);
  });
});

describe('samaItems & ringkas', () => {
  it('membandingkan jumlah santri per tingkat', () => {
    const a = hitungPesanan([{ kelasId: 'a', name: '7A', tingkat: '7', jumlahSantri: 10 }]).items;
    const b = hitungPesanan([{ kelasId: 'a', name: '7A', tingkat: '7', jumlahSantri: 10 }]).items;
    const c = hitungPesanan([{ kelasId: 'a', name: '7A', tingkat: '7', jumlahSantri: 11 }]).items;
    assert.equal(samaItems(a, b), true);
    assert.equal(samaItems(a, c), false);
    assert.deepEqual(ringkas(c), { totalSantri: 11, totalGuru: 1, grandTotal: 12 });
  });
});
