import { normalizeTurkish } from '../../common/utils/turkish-char.util.js';

export type Semester = 'GANJIL' | 'GENAP';

// Ejaan semester diseragamkan (lihat ringkasan.md poin 5: bug 'Ganjil' vs 'GANJIL').
export function normalizeSemester(raw: unknown): Semester | null {
  const s = String(raw ?? '').trim().toUpperCase();
  if (s === 'GANJIL' || s === '1') return 'GANJIL';
  if (s === 'GENAP' || s === '2') return 'GENAP';
  return null;
}

export function tahunAjaranValid(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const m = /^(\d{4})\/(\d{4})$/.exec(raw.trim());
  return !!m && Number(m[2]) === Number(m[1]) + 1;
}

export interface SesiRef { tahunAjaran: string; semester: string; }

export function labelSesi(s: SesiRef): string {
  return `Semester ${s.semester === 'GENAP' ? 'Genap' : 'Ganjil'} Tahun Ajaran ${s.tahunAjaran}`;
}

const kodeAman = (s: string) => s.toUpperCase().replace(/[^A-Z0-9-]/g, '');
const prefixSesi = (s: SesiRef) => `PBM/${s.tahunAjaran.replace('/', '-')}/${s.semester}`;

export function nomorCabang(sesi: SesiRef, cabang: { id: string; kode: string | null }): string {
  const kode = kodeAman(cabang.kode || '') || kodeAman(cabang.id.slice(0, 8));
  return `${prefixSesi(sesi)}/C/${kode}`;
}

export function nomorWilayah(sesi: SesiRef, wilayahId: string): string {
  return `${prefixSesi(sesi)}/W/${kodeAman(wilayahId.slice(0, 8))}`;
}

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const WIB_MS = 7 * 60 * 60 * 1000;

// Dihitung manual (UTC+7) agar tidak bergantung pada ICU/timezone container.
export function formatTanggal(d: Date): string {
  const w = new Date(d.getTime() + WIB_MS);
  return `${w.getUTCDate()} ${BULAN[w.getUTCMonth()]} ${w.getUTCFullYear()}`;
}

export function formatWaktu(d: Date): string {
  const w = new Date(d.getTime() + WIB_MS);
  const jam = String(w.getUTCHours()).padStart(2, '0');
  const menit = String(w.getUTCMinutes()).padStart(2, '0');
  return `${formatTanggal(d)} ${jam}:${menit} WIB`;
}

export function namaFileAman(s: string): string {
  return (
    normalizeTurkish(String(s ?? ''))
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 100) || 'dokumen'
  );
}
