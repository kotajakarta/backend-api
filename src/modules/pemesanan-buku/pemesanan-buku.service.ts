import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PDFDocument } from 'pdf-lib';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { PemesananBukuSesiService, type SesiDto, type SesiRow } from './pemesanan-buku-sesi.service.js';
import { PemesananBukuPdfService, type BeritaAcaraData } from './pemesanan-buku-pdf.service.js';
import { PemesananBukuTtdStorage } from './pemesanan-buku-ttd.storage.js';
import {
  hitungPesanan,
  itemRingkas,
  kelompokkanRombel,
  ringkas,
  samaItems,
  TINGKAT_LIST,
  type HasilHitung,
  type ItemRingkas,
  type Ringkasan,
} from './pemesanan-buku-hitung.js';
import { labelSesi, namaFileAman, nomorCabang, nomorWilayah } from './pemesanan-buku-format.js';
import { decodeNamaBerkas, deteksiJenisBerkas, EXT_BERKAS, MAX_TTD_BYTES, MIME_BERKAS } from './pemesanan-buku-file.js';

export const MSG_KONFLIK = 'Status pesanan sudah berubah, silakan muat ulang halaman.';
export const MSG_TERKUNCI = 'Pesanan sudah dikunci.';
export const MSG_WILAYAH_TERKUNCI = 'Pesanan wilayah sudah dikunci. Hubungi Admin untuk membuka kunci.';
export const MSG_AKSES = 'Akses ditolak.';
const MSG_BELUM_CETAK = 'Cetak Berita Acara terlebih dahulu, tanda tangani, lalu unggah hasil scannya.';
const MSG_BA_BERUBAH = 'Data pesanan berubah sejak Berita Acara dicetak. Cetak ulang Berita Acara, tanda tangani, lalu unggah.';

export interface PenggunaPesanan {
  id: string;
  scope: string;
  cabangId?: string | null;
  wilayahId?: string | null;
  operatorName?: string | null;
  username?: string | null;
}

export interface CabangView {
  sesi: SesiDto;
  cabang: { id: string; name: string; kode: string | null; wilayahId: string | null; wilayahName: string | null };
  status: 'BELUM' | 'DRAFT_CABANG' | 'SUBMITTED_CABANG';
  pesananId: string | null;
  nomor: string | null;
  draftAt: Date | null;
  submittedAt: Date | null;
  submittedByName: string | null;
  live: HasilHitung | null;
  snapshot: (Ringkasan & { items: ItemRingkas[] }) | null;
  berubah: boolean;
  wilayahTerkunci: boolean;
}

export type StatusBarisCabang = 'BELUM' | 'DRAFT_CABANG' | 'SUBMITTED_CABANG' | 'TIDAK_ADA_SANTRI';

export interface BarisCabang {
  cabangId: string;
  cabangName: string;
  kode: string | null;
  pesananId: string | null;
  nomor: string | null;
  status: StatusBarisCabang;
  items: ItemRingkas[];
  total: number;
  submittedAt: Date | null;
}

interface PesananWilayahRow {
  id: string;
  status: 'DRAFT_WILAYAH' | 'SUBMITTED_WILAYAH';
  nomor: string;
  ttdFileKey: string | null;
  ttdFileName: string | null;
  ttdMime: string | null;
  ttdUploadedAt: Date | null;
  baFingerprint: string | null;
  baDicetakAt: Date | null;
  resetAlasan: string | null;
  resetAt: Date | null;
  draftAt: Date | null;
  submittedAt: Date | null;
  submittedByName: string | null;
}

interface StateWilayah {
  wilayah: { id: string; name: string };
  rows: BarisCabang[];
  totalPerTingkat: ItemRingkas[];
  grandTotal: number;
  pendingCabang: string[];
  siapCetak: boolean;
  pesanan: PesananWilayahRow | null;
}

export interface WilayahView {
  sesi: SesiDto;
  wilayah: { id: string; name: string };
  nomor: string;
  status: 'BELUM' | 'DRAFT_WILAYAH' | 'SUBMITTED_WILAYAH';
  pesananId: string | null;
  rows: BarisCabang[];
  totalPerTingkat: ItemRingkas[];
  grandTotal: number;
  siapCetak: boolean;
  pendingCabang: string[];
  ttd: { fileName: string; mime: string; uploadedAt: Date | null } | null;
  baDicetakAt: Date | null;
  /** Alasan scan/cetakan wilayah dilepas otomatis (cabang memesan / admin membuka kunci). */
  pemberitahuan: { alasan: string; waktu: Date | null } | null;
  draftAt: Date | null;
  submittedAt: Date | null;
  submittedByName: string | null;
}

export interface RekapWilayah {
  wilayahId: string;
  wilayahName: string;
  status: WilayahView['status'];
  pesananId: string | null;
  nomor: string;
  ttdAda: boolean;
  submittedAt: Date | null;
  siapCetak: boolean;
  pendingCabang: string[];
  rows: BarisCabang[];
  totalPerTingkat: ItemRingkas[];
  grandTotal: number;
}

function jumlahkanPerTingkat(daftar: ItemRingkas[][]): ItemRingkas[] {
  return TINGKAT_LIST.map((t) => {
    const acc = { tingkat: t, jumlahSantri: 0, jumlahGuru: 0, total: 0 };
    for (const items of daftar) {
      const i = items.find((x) => x.tingkat === t);
      if (!i) continue;
      acc.jumlahSantri += i.jumlahSantri;
      acc.jumlahGuru += i.jumlahGuru;
      acc.total += i.total;
    }
    return acc;
  });
}

/** Sidik baris Berita Acara: berubah bila ada pesanan cabang terkunci yang bertambah/berganti. */
function sidikBeritaAcara(rows: BarisCabang[]): string {
  const isi = rows
    .filter((r) => r.status === 'SUBMITTED_CABANG')
    .map((r) => `${r.pesananId}|${r.submittedAt?.toISOString() ?? ''}|${r.items.map((i) => `${i.tingkat}:${i.total}`).join(',')}`)
    .sort()
    .join(';');
  return createHash('sha256').update(isi).digest('hex').slice(0, 10).toUpperCase();
}

/** Coba gabungkan scan ke PDF sementara, persis seperti saat membuat PDF final. */
async function scanBisaDibaca(buffer: Buffer, jenis: 'pdf' | 'png' | 'jpg'): Promise<boolean> {
  try {
    const doc = await PDFDocument.create();
    if (jenis === 'pdf') {
      const src = await PDFDocument.load(buffer);
      return (await doc.copyPages(src, src.getPageIndices())).length > 0;
    }
    await (jenis === 'png' ? doc.embedPng(buffer) : doc.embedJpg(buffer));
    return true;
  } catch {
    return false;
  }
}

@Injectable()
export class PemesananBukuService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PemesananBukuSesiService) private readonly sesiService: PemesananBukuSesiService,
    @Inject(PemesananBukuPdfService) private readonly pdfService: PemesananBukuPdfService,
    @Inject(PemesananBukuTtdStorage) private readonly ttdStorage: PemesananBukuTtdStorage,
  ) {}

  // ───────────── helper umum ─────────────

  private namaPengguna(u: PenggunaPesanan): string | null {
    return u.operatorName || u.username || null;
  }

  private wajibScope(u: PenggunaPesanan, scope: 'CABANG' | 'WILAYAH') {
    // RequireScope('CABANG') juga meloloskan GLOBAL/WILAYAH, jadi aksi tulis dicek eksak di sini.
    if (u.scope !== scope) {
      throw new ForbiddenException(`Aksi ini hanya untuk akun ${scope === 'CABANG' ? 'Cabang' : 'Wilayah'}.`);
    }
  }

  /**
   * Angka live per cabang dari rombel aktif. Public agar bisa di-stub di test
   * (fake prisma tidak mendukung filter relasi siswaFormal → student).
   */
  async hitungLive(cabangIds: string[]): Promise<Map<string, HasilHitung>> {
    const hasil = new Map<string, HasilHitung>();
    if (cabangIds.length === 0) return hasil;
    const kelas = await this.prisma.kelas.findMany({
      where: { cabangId: { in: cabangIds }, isActive: true },
      select: { id: true, name: true, tingkat: true, cabangId: true },
    });
    // Dihitung di SQL (bukan satu baris per santri). Santri hanya dihitung di cabang rombelnya sendiri.
    const jumlah = kelas.length === 0
      ? []
      : await this.prisma.$queryRaw<{ kelas_id: string; jumlah: bigint }[]>`
          SELECT sf.kelas_id, COUNT(*) AS jumlah
          FROM formal.siswa_formal sf
          JOIN formal.kelas k ON k.id = sf.kelas_id
          JOIN core.students s ON s.id = sf.student_id
          WHERE k.cabang_id IN (${Prisma.join(cabangIds)}) AND k.is_active = true
            AND s.status_pool = 'AKTIF_CABANG' AND s.cabang_id = k.cabang_id
          GROUP BY sf.kelas_id`;
    const perCabang = kelompokkanRombel(kelas, new Map(jumlah.map((r) => [r.kelas_id, Number(r.jumlah)])));
    for (const id of cabangIds) hasil.set(id, hitungPesanan(perCabang.get(id) ?? []));
    return hasil;
  }

  /**
   * Lepas scan, cetakan BA, dan draft wilayah karena angka cabang berubah; simpan alasannya untuk wilayah.
   * Mengembalikan key scan yang harus dihapus (null bila proses lain sudah mereset duluan).
   */
  private async resetPesananWilayah(tx: Prisma.TransactionClient, pw: { id: string; ttdFileKey: string | null }, alasan: string) {
    const res = await tx.pemesananBukuWilayah.updateMany({
      where: { id: pw.id, status: 'DRAFT_WILAYAH' },
      data: {
        ttdFileKey: null, ttdFileName: null, ttdMime: null, ttdUploadedAt: null,
        baFingerprint: null, baDicetakAt: null, draftAt: null,
        resetAlasan: alasan, resetAt: new Date(),
      },
    });
    if (res.count > 0) return pw.ttdFileKey;
    // 0 baris: hanya konflik bila wilayah sudah terkunci; selain itu proses lain sudah mereset.
    const kini = await tx.pemesananBukuWilayah.findUnique({ where: { id: pw.id }, select: { status: true } });
    if (kini?.status === 'SUBMITTED_WILAYAH') throw new ConflictException(MSG_KONFLIK);
    return null;
  }

  // ───────────── cabang ─────────────

  private async aksesCabang(u: PenggunaPesanan, sesiId: string, cabangIdParam?: string) {
    let cabangId: string;
    if (u.scope === 'CABANG') {
      if (!u.cabangId || (cabangIdParam && cabangIdParam !== u.cabangId)) throw new ForbiddenException(MSG_AKSES);
      cabangId = u.cabangId;
    } else if (u.scope === 'WILAYAH' || u.scope === 'GLOBAL' || u.scope === 'AUDITOR') {
      if (!cabangIdParam) throw new BadRequestException('Parameter cabangId wajib diisi.');
      cabangId = cabangIdParam;
    } else {
      throw new ForbiddenException(MSG_AKSES);
    }
    const cabang = await this.prisma.cabang.findUnique({
      where: { id: cabangId },
      select: { id: true, name: true, kode: true, wilayahId: true, wilayah: { select: { name: true } } },
    });
    if (!cabang) throw new NotFoundException('Cabang tidak ditemukan.');
    const pesanan = await this.prisma.pemesananBukuCabang.findUnique({
      where: { sesiId_cabangId: { sesiId, cabangId } },
      include: { items: { orderBy: { tingkat: 'asc' } } },
    });
    if (u.scope === 'WILAYAH' && (!u.wilayahId || (cabang.wilayahId !== u.wilayahId && pesanan?.wilayahId !== u.wilayahId))) {
      throw new ForbiddenException(MSG_AKSES);
    }
    return { cabang, pesanan };
  }

  async getCabang(u: PenggunaPesanan, sesiId?: string, cabangIdParam?: string): Promise<CabangView> {
    const sesi = await this.sesiService.resolveSesi(sesiId);
    const { cabang, pesanan } = await this.aksesCabang(u, sesi.id, cabangIdParam);
    const terkunci = pesanan?.status === 'SUBMITTED_CABANG';
    const live = terkunci ? null : (await this.hitungLive([cabang.id])).get(cabang.id)!;
    const snapshotItems = pesanan ? pesanan.items.map(itemRingkas) : null;
    const wilayahId = pesanan?.wilayahId ?? cabang.wilayahId;
    const pw = wilayahId
      ? await this.prisma.pemesananBukuWilayah.findUnique({
          where: { sesiId_wilayahId: { sesiId: sesi.id, wilayahId } },
          select: { status: true },
        })
      : null;
    return {
      sesi: this.sesiService.toDto(sesi),
      cabang: { id: cabang.id, name: cabang.name, kode: cabang.kode, wilayahId: cabang.wilayahId, wilayahName: cabang.wilayah?.name ?? null },
      status: pesanan?.status ?? 'BELUM',
      pesananId: pesanan?.id ?? null,
      nomor: pesanan?.nomor ?? null,
      draftAt: pesanan?.draftAt ?? null,
      submittedAt: pesanan?.submittedAt ?? null,
      submittedByName: pesanan?.submittedByName ?? null,
      live,
      snapshot: snapshotItems ? { items: snapshotItems, ...ringkas(snapshotItems) } : null,
      berubah: !!(snapshotItems && live && !samaItems(snapshotItems, live.items)),
      wilayahTerkunci: pw?.status === 'SUBMITTED_WILAYAH',
    };
  }

  simpanDraftCabang(u: PenggunaPesanan, sesiId: string) {
    return this.simpanPesananCabang(u, sesiId, 'DRAFT_CABANG');
  }

  submitCabang(u: PenggunaPesanan, sesiId: string) {
    return this.simpanPesananCabang(u, sesiId, 'SUBMITTED_CABANG');
  }

  private async simpanPesananCabang(u: PenggunaPesanan, sesiId: string, target: 'DRAFT_CABANG' | 'SUBMITTED_CABANG') {
    this.wajibScope(u, 'CABANG');
    const sesi = await this.sesiService.resolveSesi(sesiId);
    this.sesiService.assertTerbuka(sesi);
    const { cabang, pesanan } = await this.aksesCabang(u, sesi.id);
    if (pesanan?.status === 'SUBMITTED_CABANG') throw new BadRequestException(MSG_TERKUNCI);
    if (!cabang.wilayahId) throw new BadRequestException('Cabang belum terhubung ke wilayah, hubungi Admin.');
    const wilayahId = cabang.wilayahId;
    const pw = await this.prisma.pemesananBukuWilayah.findUnique({
      where: { sesiId_wilayahId: { sesiId: sesi.id, wilayahId } },
    });
    if (pw?.status === 'SUBMITTED_WILAYAH') throw new BadRequestException(MSG_WILAYAH_TERKUNCI);

    const hasil = (await this.hitungLive([cabang.id])).get(cabang.id)!;
    if (target === 'SUBMITTED_CABANG' && hasil.totalSantri === 0) {
      throw new BadRequestException('Tidak ada santri di rombel tingkat 7–12.');
    }
    const now = new Date();
    const data =
      target === 'DRAFT_CABANG'
        ? { wilayahId, status: target, draftAt: now }
        : { wilayahId, status: target, submittedAt: now, submittedById: u.id, submittedByName: this.namaPengguna(u) };
    const items = hasil.items.map(itemRingkas);
    let scanBasi = null as string | null;

    try {
      await this.prisma.$transaction(async (tx) => {
        if (!pesanan) {
          // Kode cabang unik di DB, tapi normalisasi (huruf besar, buang simbol) bisa membuat nomor sama.
          let nomor = nomorCabang(sesi, cabang);
          const bentrok = await tx.pemesananBukuCabang.findUnique({ where: { nomor }, select: { cabangId: true } });
          if (bentrok && bentrok.cabangId !== cabang.id) nomor = `${nomor}-${cabang.id.slice(0, 4).toUpperCase()}`;
          await tx.pemesananBukuCabang.create({
            data: { sesiId: sesi.id, cabangId: cabang.id, nomor, ...data, items: { create: items } },
          });
        } else {
          const res = await tx.pemesananBukuCabang.updateMany({ where: { id: pesanan.id, status: 'DRAFT_CABANG' }, data });
          if (res.count === 0) throw new ConflictException(MSG_KONFLIK);
          await tx.pemesananBukuCabangItem.deleteMany({ where: { pesananId: pesanan.id } });
          await tx.pemesananBukuCabangItem.createMany({ data: items.map((i) => ({ ...i, pesananId: pesanan.id })) });
        }
        // Angka wilayah berubah: scan bertanda tangan yang sudah diunggah tidak lagi cocok.
        if (target === 'SUBMITTED_CABANG' && pw) {
          scanBasi = await this.resetPesananWilayah(
            tx,
            pw,
            `Cabang ${cabang.name} mengirim pesanan setelah Berita Acara dicetak. Cetak ulang Berita Acara, tanda tangani, lalu unggah kembali.`,
          );
        }
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException(MSG_KONFLIK);
      throw e;
    }
    if (scanBasi) await this.ttdStorage.hapus(scanBasi);
    return this.getCabang(u, sesi.id);
  }

  async buktiCabangPdf(u: PenggunaPesanan, sesiId?: string, cabangIdParam?: string) {
    const sesi = await this.sesiService.resolveSesi(sesiId);
    const { cabang, pesanan } = await this.aksesCabang(u, sesi.id, cabangIdParam);
    if (!pesanan || pesanan.status !== 'SUBMITTED_CABANG') {
      throw new BadRequestException('Bukti pesanan tersedia setelah pesanan dikunci.');
    }
    const wilayah = await this.prisma.wilayah.findUnique({ where: { id: pesanan.wilayahId }, select: { name: true } });
    const buffer = await this.pdfService.buktiCabang({
      nomor: pesanan.nomor,
      cabangName: cabang.name,
      wilayahName: wilayah?.name ?? '-',
      sesiLabel: labelSesi(sesi),
      status: 'Terkunci (sudah dipesan)',
      submittedAt: pesanan.submittedAt,
      submittedByName: pesanan.submittedByName,
      items: pesanan.items.map(itemRingkas),
      dicetakPada: new Date(),
    });
    return { buffer, filename: `Bukti_Pesanan_Buku_${namaFileAman(cabang.name)}_${namaFileAman(sesi.tahunAjaran)}_${sesi.semester}.pdf` };
  }

  // ───────────── wilayah ─────────────

  private async aksesWilayah(u: PenggunaPesanan, wilayahIdParam?: string) {
    let wilayahId: string;
    if (u.scope === 'WILAYAH') {
      if (!u.wilayahId || (wilayahIdParam && wilayahIdParam !== u.wilayahId)) throw new ForbiddenException(MSG_AKSES);
      wilayahId = u.wilayahId;
    } else if (u.scope === 'GLOBAL' || u.scope === 'AUDITOR') {
      if (!wilayahIdParam) throw new BadRequestException('Parameter wilayahId wajib diisi.');
      wilayahId = wilayahIdParam;
    } else {
      throw new ForbiddenException(MSG_AKSES);
    }
    const wilayah = await this.prisma.wilayah.findUnique({ where: { id: wilayahId }, select: { id: true, name: true } });
    if (!wilayah) throw new NotFoundException('Wilayah tidak ditemukan.');
    return { id: wilayah.id, name: wilayah.name };
  }

  private async stateWilayah(sesi: SesiRow, wilayah: { id: string; name: string }): Promise<StateWilayah> {
    return (await this.stateWilayahBanyak(sesi, [wilayah]))[0];
  }

  /** State banyak wilayah sekaligus dengan jumlah query tetap (dipakai rekap nasional). */
  private async stateWilayahBanyak(sesi: SesiRow, daftar: { id: string; name: string }[]): Promise<StateWilayah[]> {
    const ids = daftar.map((w) => w.id);
    const cabangAktif = await this.prisma.cabang.findMany({
      where: { wilayahId: { in: ids }, isActive: true },
      select: { id: true, name: true, kode: true, wilayahId: true },
    });
    const pesananList = await this.prisma.pemesananBukuCabang.findMany({
      where: { sesiId: sesi.id, OR: [{ wilayahId: { in: ids } }, { cabangId: { in: cabangAktif.map((c) => c.id) } }] },
      include: { items: { orderBy: { tingkat: 'asc' } }, cabang: { select: { id: true, name: true, kode: true } } },
    });
    const pesananByCabang = new Map(pesananList.map((p) => [p.cabangId, p]));
    const live = await this.hitungLive(
      cabangAktif.filter((c) => pesananByCabang.get(c.id)?.status !== 'SUBMITTED_CABANG').map((c) => c.id),
    );
    const pesananWilayah = (await this.prisma.pemesananBukuWilayah.findMany({
      where: { sesiId: sesi.id, wilayahId: { in: ids } },
    })) as (PesananWilayahRow & { wilayahId: string })[];

    return daftar.map((wilayah) => {
      const rows: BarisCabang[] = [];
      // Pesanan terkunci milik wilayah ini selalu ikut, walau cabangnya kini pindah/nonaktif.
      for (const p of pesananList) {
        if (p.status !== 'SUBMITTED_CABANG' || p.wilayahId !== wilayah.id) continue;
        const items = p.items.map(itemRingkas);
        rows.push({
          cabangId: p.cabangId, cabangName: p.cabang.name, kode: p.cabang.kode, pesananId: p.id, nomor: p.nomor,
          status: 'SUBMITTED_CABANG', items, total: ringkas(items).grandTotal, submittedAt: p.submittedAt,
        });
      }
      // Cabang aktif yang belum terkunci memakai angka live.
      for (const c of cabangAktif) {
        if (c.wilayahId !== wilayah.id) continue;
        const p = pesananByCabang.get(c.id);
        if (p?.status === 'SUBMITTED_CABANG') continue; // sudah masuk di atas, atau terkunci di wilayah lamanya
        const hasil = live.get(c.id)!;
        rows.push({
          cabangId: c.id, cabangName: c.name, kode: c.kode, pesananId: p?.id ?? null, nomor: p?.nomor ?? null,
          status: hasil.totalSantri === 0 ? 'TIDAK_ADA_SANTRI' : p ? 'DRAFT_CABANG' : 'BELUM',
          items: hasil.items.map(itemRingkas), total: hasil.grandTotal, submittedAt: null,
        });
      }
      rows.sort((a, b) => a.cabangName.localeCompare(b.cabangName, 'id'));

      const pesanan = pesananWilayah.find((p) => p.wilayahId === wilayah.id) ?? null;
      // Wilayah terkunci: angka mengikuti Berita Acara yang ditandatangani, cabang yang baru eligible tidak ikut.
      const terkunci = pesanan?.status === 'SUBMITTED_WILAYAH';
      const dihitung = rows.filter((r) => (terkunci ? r.status === 'SUBMITTED_CABANG' : r.status !== 'TIDAK_ADA_SANTRI'));
      const totalPerTingkat = jumlahkanPerTingkat(dihitung.map((r) => r.items));
      const pendingCabang = terkunci
        ? []
        : rows.filter((r) => r.status === 'BELUM' || r.status === 'DRAFT_CABANG').map((r) => r.cabangName);
      return {
        wilayah,
        rows,
        totalPerTingkat,
        grandTotal: ringkas(totalPerTingkat).grandTotal,
        pendingCabang,
        siapCetak: pendingCabang.length === 0 && rows.some((r) => r.status === 'SUBMITTED_CABANG'),
        pesanan,
      };
    });
  }

  private viewWilayah(sesi: SesiRow, st: StateWilayah): WilayahView {
    const p = st.pesanan;
    return {
      sesi: this.sesiService.toDto(sesi),
      wilayah: st.wilayah,
      nomor: p?.nomor ?? nomorWilayah(sesi, st.wilayah.id),
      // Row yang baru dibuat karena BA dicetak (belum ada scan/draft) masih dianggap BELUM.
      status: !p || (p.status === 'DRAFT_WILAYAH' && !p.ttdFileKey && !p.draftAt) ? 'BELUM' : p.status,
      pesananId: p?.id ?? null,
      rows: st.rows,
      totalPerTingkat: st.totalPerTingkat,
      grandTotal: st.grandTotal,
      siapCetak: st.siapCetak,
      pendingCabang: st.pendingCabang,
      ttd: p?.ttdFileKey ? { fileName: p.ttdFileName ?? 'scan', mime: p.ttdMime ?? '', uploadedAt: p.ttdUploadedAt } : null,
      baDicetakAt: p?.baDicetakAt ?? null,
      pemberitahuan: p?.resetAlasan ? { alasan: p.resetAlasan, waktu: p.resetAt } : null,
      draftAt: p?.draftAt ?? null,
      submittedAt: p?.submittedAt ?? null,
      submittedByName: p?.submittedByName ?? null,
    };
  }

  async getWilayah(u: PenggunaPesanan, sesiId?: string, wilayahIdParam?: string): Promise<WilayahView> {
    const sesi = await this.sesiService.resolveSesi(sesiId);
    const wilayah = await this.aksesWilayah(u, wilayahIdParam);
    return this.viewWilayah(sesi, await this.stateWilayah(sesi, wilayah));
  }

  private assertSiapCetak(st: StateWilayah) {
    if (st.siapCetak) return;
    throw new BadRequestException(
      st.pendingCabang.length
        ? `Masih ada cabang yang belum memesan: ${st.pendingCabang.join(', ')}.`
        : 'Belum ada pesanan cabang yang terkunci.',
    );
  }

  private assertCetakanCocok(st: StateWilayah) {
    if (!st.pesanan?.baFingerprint) throw new BadRequestException(MSG_BELUM_CETAK);
    if (st.pesanan.baFingerprint !== sidikBeritaAcara(st.rows)) throw new BadRequestException(MSG_BA_BERUBAH);
  }

  private dataBeritaAcara(sesi: SesiRow, st: StateWilayah): BeritaAcaraData {
    return {
      wilayahName: st.wilayah.name,
      sesiLabel: labelSesi(sesi),
      nomor: st.pesanan?.nomor ?? nomorWilayah(sesi, st.wilayah.id),
      kode: sidikBeritaAcara(st.rows),
      rows: st.rows
        .filter((r) => r.status === 'SUBMITTED_CABANG')
        .map((r) => ({ cabangName: r.cabangName, items: r.items, total: r.total })),
      dicetakPada: new Date(),
    };
  }

  private namaFileWilayah(prefix: string, sesi: SesiRow, wilayah: { name: string }) {
    return `${prefix}_${namaFileAman(wilayah.name)}_${namaFileAman(sesi.tahunAjaran)}_${sesi.semester}.pdf`;
  }

  async beritaAcaraPdf(u: PenggunaPesanan, sesiId?: string, wilayahIdParam?: string) {
    const sesi = await this.sesiService.resolveSesi(sesiId);
    const wilayah = await this.aksesWilayah(u, wilayahIdParam);
    const st = await this.stateWilayah(sesi, wilayah);
    this.assertSiapCetak(st);
    const data = this.dataBeritaAcara(sesi, st);
    if (u.scope === 'WILAYAH' && st.pesanan?.status !== 'SUBMITTED_WILAYAH') {
      // Catat sidik cetakan: scan yang diunggah nanti harus berasal dari cetakan dengan data yang sama.
      const catat = { baFingerprint: data.kode!, baDicetakAt: data.dicetakPada, resetAlasan: null, resetAt: null };
      if (!st.pesanan) {
        try {
          await this.prisma.pemesananBukuWilayah.create({
            data: { sesiId: sesi.id, wilayahId: wilayah.id, status: 'DRAFT_WILAYAH', nomor: data.nomor, ...catat },
          });
        } catch (e: any) {
          if (e?.code !== 'P2002') throw e; // cetak bersamaan di tab lain: row sudah dibuat
          await this.prisma.pemesananBukuWilayah.updateMany({ where: { sesiId: sesi.id, wilayahId: wilayah.id, status: 'DRAFT_WILAYAH' }, data: catat });
        }
      } else {
        await this.prisma.pemesananBukuWilayah.updateMany({ where: { id: st.pesanan.id, status: 'DRAFT_WILAYAH' }, data: catat });
      }
    }
    const buffer = await this.pdfService.beritaAcara(data);
    return { buffer, filename: this.namaFileWilayah('Berita_Acara_Pemesanan_Buku', sesi, wilayah) };
  }

  async uploadTtd(u: PenggunaPesanan, sesiId: string, file?: Express.Multer.File) {
    this.wajibScope(u, 'WILAYAH');
    // Multipart tidak melewati DTO: tanpa ini sesiId kosong diam-diam jatuh ke sesi aktif.
    if (!sesiId || typeof sesiId !== 'string') throw new BadRequestException('Parameter sesiId wajib diisi.');
    if (!file) throw new BadRequestException('Berkas scan wajib diunggah.');
    if (file.size > MAX_TTD_BYTES) throw new BadRequestException('Ukuran berkas maksimal 10 MB.');
    const jenis = deteksiJenisBerkas(file.buffer, file.originalname);
    if (!jenis) throw new BadRequestException('Format berkas harus PDF, JPG, atau PNG.');
    // Uji gabung sekarang (PDF terenkripsi/rusak, gambar rusak) agar PDF final tidak gagal belakangan.
    if (!(await scanBisaDibaca(file.buffer, jenis))) {
      throw new BadRequestException('Berkas scan tidak dapat dibaca, unggah ulang hasil scan.');
    }
    const sesi = await this.sesiService.resolveSesi(sesiId);
    this.sesiService.assertTerbuka(sesi);
    const wilayah = await this.aksesWilayah(u);
    const st = await this.stateWilayah(sesi, wilayah);
    if (st.pesanan?.status === 'SUBMITTED_WILAYAH') throw new BadRequestException(MSG_WILAYAH_TERKUNCI);
    this.assertSiapCetak(st);
    this.assertCetakanCocok(st);

    const key = `pemesanan-buku/ttd/${sesi.id}/${wilayah.id}_${Date.now()}_${randomBytes(3).toString('hex')}${EXT_BERKAS[jenis]}`;
    await this.ttdStorage.simpan(key, file.buffer, MIME_BERKAS[jenis]);
    const ttd = {
      ttdFileKey: key,
      ttdFileName: decodeNamaBerkas(file.originalname).slice(0, 200),
      ttdMime: MIME_BERKAS[jenis],
      ttdUploadedAt: new Date(),
    };
    const pesanan = st.pesanan!; // dijamin ada oleh assertCetakanCocok
    // baFingerprint ikut di where: gagal bila BA dicetak ulang / data berubah di antara baca dan tulis.
    const res = await this.prisma.pemesananBukuWilayah.updateMany({
      // ttdFileKey lama ikut di where: upload pengganti yang bersamaan → satu kalah (409) dan berkasnya dihapus.
      where: { id: pesanan.id, status: 'DRAFT_WILAYAH', baFingerprint: pesanan.baFingerprint, ttdFileKey: pesanan.ttdFileKey },
      data: ttd,
    });
    if (res.count === 0) {
      await this.ttdStorage.hapus(key);
      throw new ConflictException(MSG_KONFLIK);
    }
    if (pesanan.ttdFileKey) await this.ttdStorage.hapus(pesanan.ttdFileKey);
    return this.getWilayah(u, sesi.id);
  }

  async ambilTtd(u: PenggunaPesanan, sesiId?: string, wilayahIdParam?: string) {
    const sesi = await this.sesiService.resolveSesi(sesiId);
    const wilayah = await this.aksesWilayah(u, wilayahIdParam);
    const p = await this.prisma.pemesananBukuWilayah.findUnique({
      where: { sesiId_wilayahId: { sesiId: sesi.id, wilayahId: wilayah.id } },
    });
    if (!p?.ttdFileKey) throw new NotFoundException('Scan tanda tangan belum diunggah.');
    const buffer = await this.ttdStorage.ambil(p.ttdFileKey);
    if (!buffer) throw new NotFoundException('Berkas scan tidak ditemukan di penyimpanan.');
    return { buffer, mime: p.ttdMime || 'application/octet-stream', filename: p.ttdFileName || 'scan-ttd' };
  }

  simpanDraftWilayah(u: PenggunaPesanan, sesiId: string) {
    return this.ubahStatusWilayah(u, sesiId, 'DRAFT_WILAYAH');
  }

  submitWilayah(u: PenggunaPesanan, sesiId: string) {
    return this.ubahStatusWilayah(u, sesiId, 'SUBMITTED_WILAYAH');
  }

  private async ubahStatusWilayah(u: PenggunaPesanan, sesiId: string, target: 'DRAFT_WILAYAH' | 'SUBMITTED_WILAYAH') {
    this.wajibScope(u, 'WILAYAH');
    const sesi = await this.sesiService.resolveSesi(sesiId);
    this.sesiService.assertTerbuka(sesi);
    const wilayah = await this.aksesWilayah(u);
    const st = await this.stateWilayah(sesi, wilayah);
    if (st.pesanan?.status === 'SUBMITTED_WILAYAH') throw new BadRequestException(MSG_WILAYAH_TERKUNCI);
    this.assertSiapCetak(st);
    if (!st.pesanan?.ttdFileKey) throw new BadRequestException('Unggah scan Berita Acara bertanda tangan terlebih dahulu.');
    this.assertCetakanCocok(st);
    const now = new Date();
    const data =
      target === 'DRAFT_WILAYAH'
        ? { draftAt: now }
        : { status: target, submittedAt: now, submittedById: u.id, submittedByName: this.namaPengguna(u) };
    const res = await this.prisma.pemesananBukuWilayah.updateMany({ where: { id: st.pesanan.id, status: 'DRAFT_WILAYAH' }, data });
    if (res.count === 0) throw new ConflictException(MSG_KONFLIK);
    return this.getWilayah(u, sesi.id);
  }

  async finalPdf(u: PenggunaPesanan, sesiId?: string, wilayahIdParam?: string) {
    const sesi = await this.sesiService.resolveSesi(sesiId);
    const wilayah = await this.aksesWilayah(u, wilayahIdParam);
    const st = await this.stateWilayah(sesi, wilayah);
    const p = st.pesanan;
    if (!p || p.status !== 'SUBMITTED_WILAYAH' || !p.submittedAt) {
      throw new BadRequestException('PDF final tersedia setelah pesanan wilayah dikunci.');
    }
    const scan = p.ttdFileKey ? await this.ttdStorage.ambil(p.ttdFileKey) : null;
    if (!scan || !p.ttdFileKey) throw new NotFoundException('Berkas scan tidak ditemukan di penyimpanan.');
    const jenis = deteksiJenisBerkas(scan, p.ttdFileKey);
    if (!jenis) throw new InternalServerErrorException('Berkas scan tersimpan rusak. Hubungi Admin.');
    const buffer = await this.pdfService.finalWilayah({
      ...this.dataBeritaAcara(sesi, st),
      submittedAt: p.submittedAt,
      submittedByName: p.submittedByName,
      cabang: st.rows
        .filter((r) => r.status === 'SUBMITTED_CABANG')
        .map((r) => ({ cabangName: r.cabangName, nomor: r.nomor ?? '-', submittedAt: r.submittedAt, total: r.total })),
      ttd: { buffer: scan, jenis, fileName: p.ttdFileName ?? '-', uploadedAt: p.ttdUploadedAt },
    });
    return { buffer, filename: this.namaFileWilayah('Pesanan_Final_Buku', sesi, wilayah) };
  }

  // ───────────── admin ─────────────

  async getRekap(sesiId?: string) {
    const sesi = await this.sesiService.resolveSesi(sesiId);
    const [aktif, pc, pw] = await Promise.all([
      this.prisma.wilayah.findMany({ where: { isActive: true }, select: { id: true } }),
      this.prisma.pemesananBukuCabang.findMany({ where: { sesiId: sesi.id }, select: { wilayahId: true } }),
      this.prisma.pemesananBukuWilayah.findMany({ where: { sesiId: sesi.id }, select: { wilayahId: true } }),
    ]);
    const ids = new Set<string>([...aktif.map((w) => w.id), ...pc.map((p) => p.wilayahId), ...pw.map((p) => p.wilayahId)]);
    const daftar = await this.prisma.wilayah.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const wilayah: RekapWilayah[] = [];
    for (const st of await this.stateWilayahBanyak(sesi, daftar.map((w) => ({ id: w.id, name: w.name })))) {
      const v = this.viewWilayah(sesi, st);
      const w = st.wilayah;
      wilayah.push({
        wilayahId: w.id, wilayahName: w.name, status: v.status, pesananId: v.pesananId, nomor: v.nomor,
        ttdAda: !!v.ttd, submittedAt: v.submittedAt, siapCetak: v.siapCetak, pendingCabang: v.pendingCabang,
        rows: v.rows, totalPerTingkat: v.totalPerTingkat, grandTotal: v.grandTotal,
      });
    }
    const totalPerTingkat = jumlahkanPerTingkat(wilayah.map((w) => w.totalPerTingkat));
    return { sesi: this.sesiService.toDto(sesi), wilayah, totalPerTingkat, grandTotal: ringkas(totalPerTingkat).grandTotal };
  }

  async unlockWilayah(pesananId: string): Promise<{ success: true }> {
    const p = await this.prisma.pemesananBukuWilayah.findUnique({ where: { id: pesananId } });
    if (!p) throw new NotFoundException('Pesanan wilayah tidak ditemukan.');
    this.sesiService.assertTerbuka(await this.sesiService.resolveSesi(p.sesiId));
    const res = await this.prisma.pemesananBukuWilayah.updateMany({
      where: { id: p.id, status: 'SUBMITTED_WILAYAH' },
      data: { status: 'DRAFT_WILAYAH', submittedAt: null, submittedById: null, submittedByName: null },
    });
    if (res.count === 0) throw new BadRequestException('Pesanan wilayah tidak dalam status terkunci.');
    return { success: true };
  }

  async unlockCabang(pesananId: string): Promise<{ success: true }> {
    const p = await this.prisma.pemesananBukuCabang.findUnique({ where: { id: pesananId }, include: { cabang: { select: { name: true } } } });
    if (!p) throw new NotFoundException('Pesanan cabang tidak ditemukan.');
    this.sesiService.assertTerbuka(await this.sesiService.resolveSesi(p.sesiId));
    if (p.status !== 'SUBMITTED_CABANG') throw new BadRequestException('Pesanan cabang tidak dalam status terkunci.');
    const pw = await this.prisma.pemesananBukuWilayah.findUnique({
      where: { sesiId_wilayahId: { sesiId: p.sesiId, wilayahId: p.wilayahId } },
    });
    if (pw?.status === 'SUBMITTED_WILAYAH') throw new BadRequestException('Buka kunci pesanan wilayah terlebih dahulu.');
    let scanBasi = null as string | null;
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.pemesananBukuCabang.updateMany({
        where: { id: p.id, status: 'SUBMITTED_CABANG' },
        data: { status: 'DRAFT_CABANG', submittedAt: null, submittedById: null, submittedByName: null },
      });
      if (res.count === 0) throw new ConflictException(MSG_KONFLIK);
      // Kertas bertanda tangan tidak lagi cocok dengan angka: lepas scan & cetakan wilayah.
      if (pw) {
        scanBasi = await this.resetPesananWilayah(
          tx,
          pw,
          `Admin membuka kunci pesanan cabang ${p.cabang.name}. Cetak ulang Berita Acara setelah cabang memesan kembali.`,
        );
      }
    });
    if (scanBasi) await this.ttdStorage.hapus(scanBasi);
    return { success: true };
  }
}
