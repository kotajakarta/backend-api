/**
 * Perhitungan jumlah buku Muadalah per tingkat. Pure (tanpa Prisma) supaya
 * aturan bisnisnya bisa diuji langsung.
 */
export const TINGKAT_LIST = [7, 8, 9, 10, 11, 12] as const;
export type Tingkat = (typeof TINGKAT_LIST)[number];

/** 1 buku guru untuk maksimal 30 santri, dihitung per tingkat per cabang. */
export const SANTRI_PER_BUKU_GURU = 30;

const ROMAWI: Record<string, number> = { VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };

// Exact match: "IX" harus 9, bukan 10 (dashboard.service.ts memakai includes('X') dan salah hitung).
export function parseTingkat(raw: string | null | undefined): Tingkat | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toUpperCase();
  if (!s) return null;
  const n = /^\d+$/.test(s) ? parseInt(s, 10) : ROMAWI[s];
  return (TINGKAT_LIST as readonly number[]).includes(n) ? (n as Tingkat) : null;
}

export function hitungGuru(jumlahSantri: number): number {
  return jumlahSantri > 0 ? Math.ceil(jumlahSantri / SANTRI_PER_BUKU_GURU) : 0;
}

export interface RombelRow { kelasId: string; name: string; tingkat: string | null; jumlahSantri: number; }
export interface ItemRingkas { tingkat: number; jumlahSantri: number; jumlahGuru: number; total: number; }
export interface ItemPesanan extends ItemRingkas { rombel: string[]; }
export interface RombelBermasalah { kelasId: string; name: string; tingkat: string | null; jumlahSantri: number; }
export interface Ringkasan { totalSantri: number; totalGuru: number; grandTotal: number; }
export interface HasilHitung extends Ringkasan { items: ItemPesanan[]; rombelBermasalah: RombelBermasalah[]; }

export function ringkas(items: ItemRingkas[]): Ringkasan {
  return items.reduce(
    (acc, i) => ({
      totalSantri: acc.totalSantri + i.jumlahSantri,
      totalGuru: acc.totalGuru + i.jumlahGuru,
      grandTotal: acc.grandTotal + i.total,
    }),
    { totalSantri: 0, totalGuru: 0, grandTotal: 0 },
  );
}

export function itemRingkas(i: ItemRingkas): ItemRingkas {
  return { tingkat: i.tingkat, jumlahSantri: i.jumlahSantri, jumlahGuru: i.jumlahGuru, total: i.total };
}

export function hitungPesanan(rows: RombelRow[]): HasilHitung {
  const santri = new Map<number, number>();
  const rombel = new Map<number, string[]>();
  const rombelBermasalah: RombelBermasalah[] = [];
  for (const r of rows) {
    if (r.jumlahSantri <= 0) continue;
    const t = parseTingkat(r.tingkat);
    if (t === null) {
      rombelBermasalah.push({ kelasId: r.kelasId, name: r.name, tingkat: r.tingkat, jumlahSantri: r.jumlahSantri });
      continue;
    }
    santri.set(t, (santri.get(t) ?? 0) + r.jumlahSantri);
    rombel.set(t, [...(rombel.get(t) ?? []), r.name]);
  }
  const items: ItemPesanan[] = TINGKAT_LIST.map((t) => {
    const jumlahSantri = santri.get(t) ?? 0;
    const jumlahGuru = hitungGuru(jumlahSantri);
    return {
      tingkat: t,
      jumlahSantri,
      jumlahGuru,
      total: jumlahSantri + jumlahGuru,
      rombel: [...(rombel.get(t) ?? [])].sort((a, b) => a.localeCompare(b)),
    };
  });
  return { items, ...ringkas(items), rombelBermasalah };
}

export interface KelasRow { id: string; name: string; tingkat: string | null; cabangId: string | null; }

/** Kelompokkan rombel per cabang dengan jumlah santri per kelas (dihitung di SQL). */
export function kelompokkanRombel(kelas: KelasRow[], jumlah: Map<string, number>): Map<string, RombelRow[]> {
  const hasil = new Map<string, RombelRow[]>();
  for (const k of kelas) {
    if (!k.cabangId) continue;
    const list = hasil.get(k.cabangId) ?? [];
    list.push({ kelasId: k.id, name: k.name, tingkat: k.tingkat, jumlahSantri: jumlah.get(k.id) ?? 0 });
    hasil.set(k.cabangId, list);
  }
  return hasil;
}

export function samaItems(a: ItemRingkas[], b: ItemRingkas[]): boolean {
  const kunci = (xs: ItemRingkas[]) =>
    TINGKAT_LIST.map((t) => xs.find((x) => x.tingkat === t)?.jumlahSantri ?? 0).join(',');
  return kunci(a) === kunci(b);
}
