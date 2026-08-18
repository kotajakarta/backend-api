import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { StatusSilabus, StatusKehadiranMapel } from '@prisma/client';

export interface SilabusSummaryItem {
  mataPelajaranId: string;
  name: string;
  kodeMapel: string;
  tingkat: string;
  jumlahItem: number;
  hasSilabus: boolean;
}

// Daftar tingkat yang dipakai UI Kelola Silabus. Tingkat bukan model/enum tersendiri
// di database (cuma kolom string bebas di SilabusMapel/Kelas), jadi daftarnya sama
// persis dengan TINGKAT_OPTIONS di frontend — dipakai buat mode "Semua Tingkat".
const TINGKAT_LIST = ['Non Muadalah', '7', '8', '9', '10', '11', '12'];

export interface SilabusExportItem {
  id: string;
  mataPelajaranName: string;
  kodeMapel: string;
  tingkat: string;
  tahunAjaran: string;
  semester: string;
  bab: string;
  urutanBab: number;
  section: string;
  urutanSection: number;
  tanggalTarget: Date | null;
}

@Injectable()
export class PembelajaranService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // Silabus hanya boleh diisi untuk tanggal hari ini atau sebelumnya.
  private isFutureDate(dateStr: string): boolean {
    const todayStr = new Date().toISOString().slice(0, 10);
    return dateStr.slice(0, 10) > todayStr;
  }

  // ===== A. Kelola Silabus (Admin Pusat) =====

  async getSilabus(params: { mataPelajaranId: string; tingkat: string; tahunAjaran: string; semester: string }) {
    const { mataPelajaranId, tingkat, tahunAjaran, semester } = params;
    return this.prisma.silabusMapel.findMany({
      where: { mataPelajaranId, tingkat, tahunAjaran, semester },
      orderBy: [{ urutanBab: 'asc' }, { urutanSection: 'asc' }]
    });
  }

  // Ringkasan per mapel aktif untuk satu Tingkat+TahunAjaran+Semester (atau seluruh
  // Tingkat sekaligus bila tingkat === 'ALL') — dipakai layar daftar Kelola Silabus
  // agar admin tahu kombinasi mapel+tingkat mana yang silabusnya sudah/belum diisi.
  async getSilabusSummary(params: { tingkat: string; tahunAjaran: string; semester: string }): Promise<SilabusSummaryItem[]> {
    const { tingkat, tahunAjaran, semester } = params;

    const mapelList = await this.prisma.mataPelajaran.findMany({
      where: { aktifPembelajaran: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, kodeMapel: true }
    });

    if (tingkat === 'ALL') {
      const grouped = await this.prisma.silabusMapel.groupBy({
        by: ['mataPelajaranId', 'tingkat'],
        where: { tahunAjaran, semester },
        _count: { _all: true }
      });
      const countByKey = new Map(grouped.map(g => [`${g.mataPelajaranId}::${g.tingkat}`, g._count._all]));

      const result: SilabusSummaryItem[] = [];
      for (const m of mapelList) {
        for (const t of TINGKAT_LIST) {
          const jumlahItem = countByKey.get(`${m.id}::${t}`) ?? 0;
          result.push({
            mataPelajaranId: m.id,
            name: m.name,
            kodeMapel: m.kodeMapel,
            tingkat: t,
            jumlahItem,
            hasSilabus: jumlahItem > 0
          });
        }
      }
      return result;
    }

    const grouped = await this.prisma.silabusMapel.groupBy({
      by: ['mataPelajaranId'],
      where: { tingkat, tahunAjaran, semester },
      _count: { _all: true }
    });
    const countByMapel = new Map(grouped.map(g => [g.mataPelajaranId, g._count._all]));

    return mapelList.map(m => ({
      mataPelajaranId: m.id,
      name: m.name,
      kodeMapel: m.kodeMapel,
      tingkat,
      jumlahItem: countByMapel.get(m.id) ?? 0,
      hasSilabus: (countByMapel.get(m.id) ?? 0) > 0
    }));
  }

  // Ekspor seluruh silabus di database (semua mapel, semua tingkat/tahun ajaran/semester)
  // jadi satu daftar flat — dipakai tombol "Export Semua Silabus" di layar Kelola Silabus.
  async getAllSilabusForExport(): Promise<SilabusExportItem[]> {
    const rows = await this.prisma.silabusMapel.findMany({
      include: { mataPelajaran: { select: { name: true, kodeMapel: true } } },
      orderBy: [
        { mataPelajaran: { name: 'asc' } },
        { tingkat: 'asc' },
        { tahunAjaran: 'asc' },
        { semester: 'asc' },
        { urutanBab: 'asc' },
        { urutanSection: 'asc' }
      ]
    });

    return rows.map(r => ({
      id: r.id,
      mataPelajaranName: r.mataPelajaran.name,
      kodeMapel: r.mataPelajaran.kodeMapel,
      tingkat: r.tingkat,
      tahunAjaran: r.tahunAjaran,
      semester: r.semester,
      bab: r.bab,
      urutanBab: r.urutanBab,
      section: r.section,
      urutanSection: r.urutanSection,
      tanggalTarget: r.tanggalTarget
    }));
  }

  // Replace-in-place: baris yang punya `id` di-update, yang tanpa `id` dibuat baru,
  // baris lama untuk kombinasi mapel+tingkat+periode ini yang tidak lagi dikirim akan dihapus.
  async saveSilabusBulk(data: {
    mataPelajaranId: string;
    tingkat: string;
    tahunAjaran: string;
    semester: string;
    items: Array<{ id?: string; bab: string; urutanBab: number; section: string; urutanSection: number; tanggalTarget?: string | null }>;
  }) {
    const { mataPelajaranId, tingkat, tahunAjaran, semester, items } = data;
    if (!mataPelajaranId || !tingkat || !tahunAjaran || !semester) {
      throw new BadRequestException('Mata pelajaran, tingkat, tahun ajaran, dan semester wajib diisi.');
    }

    return this.prisma.$transaction(async (tx) => {
      const keepIds = items.filter(i => i.id).map(i => i.id!);
      await tx.silabusMapel.deleteMany({
        where: { mataPelajaranId, tingkat, tahunAjaran, semester, id: { notIn: keepIds } }
      });

      const results = [];
      for (const item of items) {
        const payload = {
          bab: item.bab,
          urutanBab: item.urutanBab,
          section: item.section,
          urutanSection: item.urutanSection,
          tanggalTarget: item.tanggalTarget ? new Date(item.tanggalTarget) : null
        };
        if (item.id) {
          results.push(await tx.silabusMapel.update({ where: { id: item.id }, data: payload }));
        } else {
          results.push(await tx.silabusMapel.create({
            data: { mataPelajaranId, tingkat, tahunAjaran, semester, ...payload }
          }));
        }
      }
      return results;
    });
  }

  async deleteSilabus(id: string) {
    const silabus = await this.prisma.silabusMapel.findUnique({ where: { id } });
    if (!silabus) throw new NotFoundException('Section silabus tidak ditemukan');
    return this.prisma.silabusMapel.delete({ where: { id } });
  }

  // ===== B. Kontrol Silabus (User Cabang) =====

  async getPelaksanaan(kelasId: string, tahunAjaran: string, semester: string) {
    const kelas = await this.prisma.kelas.findUnique({ where: { id: kelasId } });
    if (!kelas) throw new NotFoundException('Kelas tidak ditemukan');
    if (!kelas.tingkat) {
      throw new BadRequestException('Kelas ini belum memiliki tingkat, silabus tidak bisa dimuat.');
    }

    // Hormati toggle di tab Pengaturan: mapel yang dinonaktifkan tidak ikut muncul di sini
    // (konsisten dengan Kelola Silabus, Dashboard, dan Laporan).
    const silabusList = await this.prisma.silabusMapel.findMany({
      where: { tingkat: kelas.tingkat, tahunAjaran, semester, isActive: true, mataPelajaran: { aktifPembelajaran: true } },
      include: { mataPelajaran: true },
      orderBy: [{ mataPelajaranId: 'asc' }, { urutanBab: 'asc' }, { urutanSection: 'asc' }]
    });

    const mapelIds = Array.from(new Set(silabusList.map(s => s.mataPelajaranId)));

    const executionsRaw = mapelIds.length > 0 ? await this.prisma.pelaksanaanSilabus.findMany({
      where: { kelasId, mataPelajaranId: { in: mapelIds }, NOT: { tanggalDiajar: null } },
      include: { guru: true }
    }) : [];

    // Guru default per mapel: siapa yang ditugaskan mengajar mapel ini di kelas ini
    const guruMapelKelasList = mapelIds.length > 0 ? await this.prisma.guruMapelKelas.findMany({
      where: { kelasId, mataPelajaranId: { in: mapelIds } },
      include: { staff: true }
    }) : [];
    const defaultGuruMap = new Map(guruMapelKelasList.map(g => [g.mataPelajaranId, g.staff]));

    // Opsi pengganti: guru aktif di cabang yang sama dengan kelas ini.
    const guruOptions = kelas.cabangId ? await this.prisma.staff.findMany({
      where: { cabangId: kelas.cabangId, statusPool: 'AKTIF_CABANG' },
      select: { id: true, name: true, position: true },
      orderBy: { name: 'asc' }
    }) : [];

    // Catatan absensi terikat pada (silabusId + tanggal)
    const absensiList = mapelIds.length > 0 ? await this.prisma.absensiMapel.findMany({
      where: { kelasId, mataPelajaranId: { in: mapelIds } },
      select: { silabusId: true, mataPelajaranId: true, tanggal: true, status: true }
    }) : [];
    const absensiSet = new Set(absensiList.map(a => `${a.mataPelajaranId}__${a.tanggal.toISOString().slice(0, 10)}`));

    // Rekap kehadiran (H/I/S/A) per baris silabus (satu baris = satu sesi materi).
    const kehadiranMap = new Map<string, { hadir: number; izin: number; sakit: number; alpa: number; total: number }>();
    absensiList.forEach(a => {
      if (!a.silabusId) return;
      const rec = kehadiranMap.get(a.silabusId) || { hadir: 0, izin: 0, sakit: 0, alpa: 0, total: 0 };
      rec.total++;
      if (a.status === 'HADIR') rec.hadir++;
      else if (a.status === 'IZIN') rec.izin++;
      else if (a.status === 'SAKIT') rec.sakit++;
      else if (a.status === 'ALPA') rec.alpa++;
      kehadiranMap.set(a.silabusId, rec);
    });

    const executions = executionsRaw.map(p => {
      const defaultGuru = p.mataPelajaranId ? defaultGuruMap.get(p.mataPelajaranId) : null;
      const tglStr = p.tanggalDiajar ? p.tanggalDiajar.toISOString().slice(0, 10) : null;
      return {
        id: p.id,
        silabusId: p.silabusId,
        mataPelajaranId: p.mataPelajaranId as string,
        status: p.status,
        tanggalDiajar: tglStr,
        catatan: p.catatan || '',
        guruId: p.guruId || defaultGuru?.id || null,
        guruName: p.guru?.name || defaultGuru?.name || null,
        hasAbsensi: p.mataPelajaranId && tglStr ? absensiSet.has(`${p.mataPelajaranId}__${tglStr}`) : false
      };
    });

    const items = silabusList.map(s => {
      const defaultGuru = defaultGuruMap.get(s.mataPelajaranId);
      return {
        silabusId: s.id,
        mataPelajaranId: s.mataPelajaranId,
        mataPelajaranName: s.mataPelajaran.name,
        bab: s.bab,
        section: s.section,
        tanggalTarget: s.tanggalTarget ? s.tanggalTarget.toISOString().slice(0, 10) : '',
        defaultGuruId: defaultGuru?.id || null,
        defaultGuruName: defaultGuru?.name || null,
        kehadiran: kehadiranMap.get(s.id) || null
      };
    });

    // Penanda "Libur" tanpa materi — tanggal yang ditandai libur untuk satu mapel di kelas ini.
    const liburMarkers = mapelIds.length > 0 ? await this.prisma.pelaksanaanSilabus.findMany({
      where: { kelasId, silabusId: null, mataPelajaranId: { in: mapelIds } },
      orderBy: { tanggalDiajar: 'asc' }
    }) : [];

    return {
      items,
      executions,
      guruOptions,
      liburMarkers: liburMarkers.map(l => ({
        id: l.id,
        mataPelajaranId: l.mataPelajaranId as string,
        tanggalDiajar: l.tanggalDiajar
      }))
    };
  }

  // Tandai satu tanggal sebagai Libur tanpa memilih materi apapun (mis. libur nasional).
  async setLiburTanggal(kelasId: string, mataPelajaranId: string, tanggal: string, userId?: string) {
    if (this.isFutureDate(tanggal)) {
      throw new BadRequestException('Tidak dapat menandai Libur untuk tanggal mendatang');
    }
    const date = new Date(tanggal);
    const existing = await this.prisma.pelaksanaanSilabus.findFirst({
      where: { kelasId, mataPelajaranId, tanggalDiajar: date, silabusId: null }
    });
    if (existing) return existing;
    return this.prisma.pelaksanaanSilabus.create({
      data: { kelasId, mataPelajaranId, tanggalDiajar: date, status: 'LIBUR', updatedById: userId || null }
    });
  }

  // Batalkan penanda Libur tanpa materi pada satu tanggal.
  async clearLiburTanggal(kelasId: string, mataPelajaranId: string, tanggal: string) {
    const date = new Date(tanggal);
    return this.prisma.pelaksanaanSilabus.deleteMany({
      where: { kelasId, mataPelajaranId, tanggalDiajar: date, silabusId: null }
    });
  }

  async savePelaksanaanBulk(
    kelasId: string,
    logs: Array<{ silabusId?: string | null; mataPelajaranId: string; status: StatusSilabus; tanggalDiajar: string; catatan?: string; guruId?: string | null }>,
    userId?: string
  ) {
    return this.prisma.$transaction(async (tx) => {
      const results = [];
      for (const log of logs) {
        if (!log.tanggalDiajar || !log.mataPelajaranId) continue;
        const date = new Date(log.tanggalDiajar);

        if (!log.silabusId && log.status !== 'LIBUR') {
          // Unassigned: hapus pelaksanaan di tanggal tersebut jika ada
          await tx.pelaksanaanSilabus.deleteMany({
            where: { kelasId, mataPelajaranId: log.mataPelajaranId, tanggalDiajar: date }
          });
          continue;
        }

        // Silabus hanya boleh diisi/diperbarui untuk tanggal hari ini atau sebelumnya.
        if (this.isFutureDate(log.tanggalDiajar)) continue;

        const dataPayload = {
          silabusId: log.silabusId || null,
          status: log.status,
          catatan: log.catatan || null,
          guruId: log.guruId || null,
          updatedById: userId || null
        };

        results.push(await tx.pelaksanaanSilabus.upsert({
          where: { kelasId_mataPelajaranId_tanggalDiajar: { kelasId, mataPelajaranId: log.mataPelajaranId, tanggalDiajar: date } },
          update: dataPayload,
          create: {
            kelasId,
            mataPelajaranId: log.mataPelajaranId,
            tanggalDiajar: date,
            ...dataPayload
          }
        }));
      }
      return results;
    });
  }

  // ===== C. Absensi Siswa per Mapel (User Cabang) — direkam per baris silabus/materi =====

  async getAbsensiMapel(kelasId: string, silabusId: string, tanggal?: string) {
    const silabus = await this.prisma.silabusMapel.findUnique({
      where: { id: silabusId },
      include: { mataPelajaran: true }
    });
    if (!silabus) throw new NotFoundException('Section silabus tidak ditemukan');

    const targetDate = tanggal ? new Date(tanggal) : undefined;
    const pelaksanaan = await this.prisma.pelaksanaanSilabus.findFirst({
      where: { silabusId, kelasId, ...(targetDate ? { tanggalDiajar: targetDate } : {}) }
    });

    const students = await this.prisma.student.findMany({
      where: { isActive: true, siswaFormal: { kelasId } },
      include: { biodata: { select: { fullName: true, nisLokal: true } } },
      orderBy: { biodata: { fullName: 'asc' } }
    });

    const existingLogs = await this.prisma.absensiMapel.findMany({
      where: { silabusId, kelasId, studentId: { in: students.map(s => s.id) }, ...(targetDate ? { tanggal: targetDate } : {}) }
    });
    const logMap = new Map(existingLogs.map(l => [l.studentId, l]));

    return {
      mataPelajaranName: silabus.mataPelajaran.name,
      bab: silabus.bab,
      section: silabus.section,
      tanggalDefault: targetDate ? targetDate.toISOString().slice(0, 10) : (pelaksanaan?.tanggalDiajar ? pelaksanaan.tanggalDiajar.toISOString().slice(0, 10) : null),
      students: students.map(student => {
        const log = logMap.get(student.id);
        return {
          studentId: student.id,
          fullName: student.biodata.fullName,
          nisLokal: student.biodata.nisLokal,
          status: log?.status || 'HADIR',
          catatan: log?.catatan || ''
        };
      })
    };
  }

  async saveAbsensiMapelBulk(
    kelasId: string,
    silabusId: string,
    tanggal: string,
    logs: Array<{ studentId: string; status: StatusKehadiranMapel; catatan?: string }>
  ) {
    const silabus = await this.prisma.silabusMapel.findUnique({ where: { id: silabusId } });
    if (!silabus) throw new NotFoundException('Section silabus tidak ditemukan');

    const date = new Date(tanggal);
    return this.prisma.$transaction(
      logs.map(log =>
        this.prisma.absensiMapel.upsert({
          where: {
            mataPelajaranId_kelasId_studentId_tanggal: {
              mataPelajaranId: silabus.mataPelajaranId,
              kelasId,
              studentId: log.studentId,
              tanggal: date
            }
          },
          update: { silabusId, status: log.status, catatan: log.catatan || null },
          create: {
            silabusId,
            mataPelajaranId: silabus.mataPelajaranId,
            kelasId,
            studentId: log.studentId,
            tanggal: date,
            status: log.status,
            catatan: log.catatan || null
          }
        })
      )
    );
  }

  // ===== D. Laporan (Admin Pusat / Wilayah) =====

  private resolveDateRange(
    mode: string,
    params: { weekStart?: string; month?: string; tahunAjaran?: string; semester?: string }
  ): { gte: Date; lte: Date } {
    if (mode === 'weekly' && params.weekStart) {
      const inputDate = new Date(params.weekStart);
      const day = inputDate.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
      const start = new Date(inputDate);
      start.setDate(inputDate.getDate() - day);
      start.setHours(0, 0, 0, 0);

      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { gte: start, lte: end };
    }
    if (mode === 'monthly' && params.month) {
      const [yearStr, monthStr] = params.month.split('-');
      const y = parseInt(yearStr);
      const m = parseInt(monthStr);
      return { gte: new Date(y, m - 1, 1), lte: new Date(y, m, 0, 23, 59, 59) };
    }
    if (mode === 'semester' && params.tahunAjaran && params.semester) {
      const [startYearStr, endYearStr] = params.tahunAjaran.split('/');
      const startYear = parseInt(startYearStr);
      const endYear = parseInt(endYearStr || startYearStr) || startYear + 1;
      if (params.semester.toUpperCase() === 'GANJIL') {
        return { gte: new Date(`${startYear}-07-01`), lte: new Date(`${startYear}-12-31T23:59:59`) };
      }
      return { gte: new Date(`${endYear}-01-01`), lte: new Date(`${endYear}-06-30T23:59:59`) };
    }
    throw new BadRequestException('Parameter periode tidak lengkap untuk mode laporan ini.');
  }

  async getLaporan(
    filters: {
      wilayahId?: string;
      cabangId?: string;
      mataPelajaranId?: string;
      mode: 'weekly' | 'monthly' | 'semester';
      weekStart?: string;
      month?: string;
      tahunAjaran?: string;
      semester?: string;
    },
    user: any
  ) {
    let effectiveWilayahId = filters.wilayahId;
    let effectiveCabangId = filters.cabangId;
    if (user?.scope === 'WILAYAH') {
      effectiveWilayahId = user.wilayahId;
    } else if (user?.scope === 'CABANG') {
      effectiveCabangId = user.cabangId;
    }

    const dateRange = this.resolveDateRange(filters.mode, filters);

    const kelasWhere: any = {};
    if (effectiveCabangId) {
      kelasWhere.cabangId = effectiveCabangId;
    } else if (effectiveWilayahId) {
      kelasWhere.cabang = { wilayahId: effectiveWilayahId };
    }

    const kelasList = await this.prisma.kelas.findMany({
      where: kelasWhere,
      include: {
        cabang: { include: { wilayah: true } },
        _count: { select: { siswaFormal: true } }
      }
    });
    const kelasIds = kelasList.map(k => k.id);
    const tingkatSet = Array.from(new Set(kelasList.map(k => k.tingkat).filter((t): t is string => !!t)));

    // Silabus untuk PROGRES SILABUS (seluruh bab/section aktif di tingkat terkait)
    const silabusList = await this.prisma.silabusMapel.findMany({
      where: {
        tingkat: { in: tingkatSet },
        isActive: true,
        mataPelajaran: { aktifPembelajaran: true },
        ...(filters.mode === 'semester' && filters.tahunAjaran && filters.semester
          ? { tahunAjaran: filters.tahunAjaran, semester: filters.semester }
          : {}),
        ...(filters.mataPelajaranId ? { mataPelajaranId: filters.mataPelajaranId } : {})
      }
    });

    const silabusIds = silabusList.map(s => s.id);

    // Record pelaksanaan silabus untuk progres silabus
    const pelaksanaanSilabusList = kelasIds.length > 0 ? await this.prisma.pelaksanaanSilabus.findMany({
      where: {
        kelasId: { in: kelasIds },
        ...(silabusIds.length > 0 ? { silabusId: { in: silabusIds } } : {})
      }
    }) : [];
    const pelaksanaanSilabusMap = new Map(pelaksanaanSilabusList.map(p => [`${p.silabusId}__${p.kelasId}`, p]));

    // Record pelaksanaan silabus dalam dateRange (untuk PELAKSANAAN PEMBELAJARAN)
    const pelaksanaanPeriodeList = kelasIds.length > 0 ? await this.prisma.pelaksanaanSilabus.findMany({
      where: {
        kelasId: { in: kelasIds },
        tanggalDiajar: dateRange,
        mataPelajaran: { aktifPembelajaran: true },
        ...(filters.mataPelajaranId ? { mataPelajaranId: filters.mataPelajaranId } : {})
      }
    }) : [];

    const mepelListAktif = await this.prisma.mataPelajaran.findMany({
      where: {
        aktifPembelajaran: true,
        ...(filters.mataPelajaranId ? { id: filters.mataPelajaranId } : {})
      }
    });

    // Record Absensi Mapel
    const absensiList = kelasIds.length > 0 ? await this.prisma.absensiMapel.findMany({
      where: {
        kelasId: { in: kelasIds },
        mataPelajaran: { aktifPembelajaran: true },
        ...(filters.mode === 'semester' ? {} : { tanggal: dateRange }),
        ...(filters.mataPelajaranId ? { mataPelajaranId: filters.mataPelajaranId } : {})
      }
    }) : [];

    const kelasById = new Map(kelasList.map(k => [k.id, k]));

    type CabangAgg = {
      cabangId: string;
      cabangName: string;
      wilayahName: string;
      jumlahRombel: number;
      jumlahSiswa: number;
      silabusCompleted: number;
      silabusTotal: number;
      hadir: number;
      totalAbsensi: number;
      pelaksanaanCompleted: number;
      pelaksanaanTotal: number;
    };
    const cabangMap = new Map<string, CabangAgg>();
    const ensureCabang = (kelas: (typeof kelasList)[number]) => {
      const id = kelas.cabangId || 'unknown';
      if (!cabangMap.has(id)) {
        cabangMap.set(id, {
          cabangId: id,
          cabangName: kelas.cabang?.name || 'Tanpa Cabang',
          wilayahName: kelas.cabang?.wilayah?.name || '-',
          jumlahRombel: 0,
          jumlahSiswa: 0,
          silabusCompleted: 0,
          silabusTotal: 0,
          hadir: 0,
          totalAbsensi: 0,
          pelaksanaanCompleted: 0,
          pelaksanaanTotal: 0
        });
      }
      return cabangMap.get(id)!;
    };

    const isKelasAktifBersiswa = (k: (typeof kelasList)[number]) =>
      k.isActive !== false && (k._count?.siswaFormal || 0) > 0;

    // Count jumlahRombel aktif dan jumlahSiswa per Cabang
    kelasList.forEach(kelas => {
      const entry = ensureCabang(kelas);
      if (isKelasAktifBersiswa(kelas)) {
        entry.jumlahRombel++;
        entry.jumlahSiswa += (kelas._count?.siswaFormal || 0);
      }
    });

    // A. Progres Silabus calculation per Cabang
    kelasList.forEach(kelas => {
      if (!kelas.tingkat) return;
      silabusList
        .filter(s => s.tingkat === kelas.tingkat)
        .forEach(s => {
          const p = pelaksanaanSilabusMap.get(`${s.id}__${kelas.id}`);
          const status = p?.status || 'PENDING';
          if (status === 'LIBUR') return;
          const entry = ensureCabang(kelas);
          entry.silabusTotal++;
          if (status === 'COMPLETED') entry.silabusCompleted++;
        });
    });

    // B. Pelaksanaan Pembelajaran calculation per Cabang in dateRange
    let periodMultiplier = 1;
    if (filters.mode === 'monthly') {
      const daysInMonth = new Date(dateRange.lte.getFullYear(), dateRange.lte.getMonth() + 1, 0).getDate();
      periodMultiplier = Math.max(1, Math.ceil(daysInMonth / 7));
    } else if (filters.mode === 'semester') {
      periodMultiplier = 18;
    }

    const pelaksanaanPeriodeMap = new Map<string, typeof pelaksanaanPeriodeList>();
    pelaksanaanPeriodeList.forEach(p => {
      const key = `${p.kelasId}__${p.mataPelajaranId}`;
      if (!pelaksanaanPeriodeMap.has(key)) pelaksanaanPeriodeMap.set(key, []);
      pelaksanaanPeriodeMap.get(key)!.push(p);
    });

    kelasList.forEach(kelas => {
      if (!isKelasAktifBersiswa(kelas)) return;
      const entry = ensureCabang(kelas);

      mepelListAktif.forEach(m => {
        const key = `${kelas.id}__${m.id}`;
        const records = pelaksanaanPeriodeMap.get(key) || [];

        // Group records by distinct date (tanggalDiajar)
        const dateMap = new Map<string, typeof records>();
        records.forEach(p => {
          const tglKey = p.tanggalDiajar ? p.tanggalDiajar.toISOString().slice(0, 10) : 'no_date';
          if (!dateMap.has(tglKey)) dateMap.set(tglKey, []);
          dateMap.get(tglKey)!.push(p);
        });

        let liburDatesCount = 0;
        let completedDatesCount = 0;

        dateMap.forEach((dateRecords) => {
          if (dateRecords.some(p => p.status === 'LIBUR')) {
            liburDatesCount++;
          } else if (dateRecords.some(p => p.status === 'COMPLETED')) {
            completedDatesCount++;
          }
        });

        let expectedTarget = Math.max(0, periodMultiplier - liburDatesCount);
        let completedCount = Math.min(expectedTarget, completedDatesCount);

        entry.pelaksanaanTotal += expectedTarget;
        entry.pelaksanaanCompleted += completedCount;
      });
    });

    // C. Absensi Mapel calculation per Cabang
    absensiList.forEach(a => {
      const kelas = kelasById.get(a.kelasId);
      if (!kelas) return;
      const entry = ensureCabang(kelas);
      entry.totalAbsensi++;
      if (a.status === 'HADIR') entry.hadir++;
    });

    const rekap = Array.from(cabangMap.values()).map(e => ({
      cabangId: e.cabangId,
      cabangName: e.cabangName,
      wilayahName: e.wilayahName,
      jumlahRombel: e.jumlahRombel,
      jumlahSiswa: e.jumlahSiswa,
      persenSilabus: e.silabusTotal > 0 ? Math.round((e.silabusCompleted / e.silabusTotal) * 100) : 0,
      silabusCompleted: e.silabusCompleted,
      silabusTotal: e.silabusTotal,
      persenKehadiran: e.totalAbsensi > 0 ? Math.round((e.hadir / e.totalAbsensi) * 100) : 0,
      hadir: e.hadir,
      totalAbsensi: e.totalAbsensi,
      persenPelaksanaan: e.pelaksanaanTotal > 0 ? Math.round((e.pelaksanaanCompleted / e.pelaksanaanTotal) * 100) : 0,
      pelaksanaanCompleted: e.pelaksanaanCompleted,
      pelaksanaanTotal: e.pelaksanaanTotal
    }));

    return {
      periode: { gte: dateRange.gte, lte: dateRange.lte },
      rekap: rekap.sort((a, b) => a.cabangName.localeCompare(b.cabangName))
    };
  }

  // ===== E. Ringkasan (Dashboard) — semua scope, unit pemantauan menyesuaikan level RBAC =====
  //   GLOBAL  -> breakdown per Wilayah (pandangan makro nasional)
  //   WILAYAH -> breakdown per Cabang (di dalam wilayahnya)
  //   CABANG  -> breakdown per Kelas (di cabangnya sendiri, supaya tetap informatif meski cuma 1 cabang)
  private countSaturdays(startDate: Date, endDate: Date): number {
    let count = 0;
    const current = new Date(startDate);
    while (current <= endDate) {
      if (current.getDay() === 6) count++;
      current.setDate(current.getDate() + 1);
    }
    return Math.max(1, count);
  }

  private statusForPercent(pct: number): 'Optimal' | 'Sesuai Jalur' | 'Berisiko' {
    return pct >= 90 ? 'Optimal' : pct >= 70 ? 'Sesuai Jalur' : 'Berisiko';
  }

  async getRingkasan(
    user: any,
    queryParams?: {
      mode?: 'weekly' | 'monthly' | 'semester' | 'yearly';
      weekStart?: string;
      month?: string;
      tahunAjaran?: string;
      semester?: string;
      kelasId?: string;
      wilayahId?: string;
      cabangId?: string;
    } | string,
    kelasIdLegacy?: string,
    wilayahIdLegacy?: string,
    cabangIdLegacy?: string
  ) {
    let mode: 'weekly' | 'monthly' | 'semester' | 'yearly' = 'monthly';
    let weekStart: string | undefined;
    let month: string | undefined;
    let reqTahunAjaran: string | undefined;
    let reqSemester: string | undefined;
    let kelasId: string | undefined;
    let wilayahId: string | undefined;
    let cabangId: string | undefined;

    if (typeof queryParams === 'object' && queryParams !== null) {
      mode = queryParams.mode || 'monthly';
      weekStart = queryParams.weekStart;
      month = queryParams.month;
      reqTahunAjaran = queryParams.tahunAjaran;
      reqSemester = queryParams.semester;
      kelasId = queryParams.kelasId;
      wilayahId = queryParams.wilayahId;
      cabangId = queryParams.cabangId;
    } else {
      month = queryParams;
      kelasId = kelasIdLegacy;
      wilayahId = wilayahIdLegacy;
      cabangId = cabangIdLegacy;
    }

    const pengaturan = await this.prisma.pengaturanAkademik.findFirst();
    const tahunAjaran = reqTahunAjaran || pengaturan?.tahunAjaran || '';
    const semester = reqSemester || pengaturan?.semesterAktif || '';

    const scopeLevel: 'GLOBAL' | 'WILAYAH' | 'CABANG' =
      user?.scope === 'CABANG' ? 'CABANG' : user?.scope === 'WILAYAH' ? 'WILAYAH' : 'GLOBAL';

    let breakdownLevel: 'WILAYAH' | 'CABANG' | 'KELAS' = 'KELAS';
    if (scopeLevel === 'CABANG' || cabangId) {
      breakdownLevel = 'KELAS';
    } else if (scopeLevel === 'WILAYAH' || wilayahId) {
      breakdownLevel = 'CABANG';
    } else {
      breakdownLevel = 'WILAYAH';
    }

    const unitLabel = breakdownLevel === 'WILAYAH' ? 'Wilayah' : breakdownLevel === 'CABANG' ? 'Cabang' : 'Kelas';

    const now = new Date();
    let startDate: Date;
    let endDate: Date;
    let periodeLabel = '';
    let selectedMonth = '';

    if (mode === 'weekly') {
      const baseDate = weekStart ? new Date(weekStart) : now;
      const day = baseDate.getDay();
      startDate = new Date(baseDate);
      startDate.setDate(baseDate.getDate() - day);
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);

      const d1 = startDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
      const d2 = endDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
      periodeLabel = `Minggu (${d1} - ${d2})`;
      selectedMonth = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
    } else if (mode === 'semester') {
      const [startYearStr, endYearStr] = tahunAjaran.split('/');
      const startYear = parseInt(startYearStr) || now.getFullYear();
      const endYear = parseInt(endYearStr || '') || startYear + 1;

      if (semester.toUpperCase() === 'GANJIL') {
        startDate = new Date(`${startYear}-07-01T00:00:00`);
        endDate = new Date(`${startYear}-12-31T23:59:59`);
      } else {
        startDate = new Date(`${endYear}-01-01T00:00:00`);
        endDate = new Date(`${endYear}-06-30T23:59:59`);
      }
      periodeLabel = `Semester ${semester} (${tahunAjaran})`;
      selectedMonth = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
    } else if (mode === 'yearly') {
      const [startYearStr] = tahunAjaran.split('/');
      const startYear = parseInt(startYearStr) || now.getFullYear();
      startDate = new Date(`${startYear}-07-01T00:00:00`);
      endDate = new Date(`${startYear + 1}-06-30T23:59:59`);
      periodeLabel = `Tahun Ajaran ${tahunAjaran}`;
      selectedMonth = `${startYear}-07`;
    } else {
      // Monthly (default)
      const validMonth = month && /^\d{4}-\d{2}$/.test(month);
      const selYear = validMonth ? parseInt(month!.slice(0, 4)) : now.getUTCFullYear();
      const selMonthIdx = validMonth ? parseInt(month!.slice(5, 7)) - 1 : now.getUTCMonth();
      const daysInMonth = new Date(Date.UTC(selYear, selMonthIdx + 1, 0)).getUTCDate();
      startDate = new Date(Date.UTC(selYear, selMonthIdx, 1, 0, 0, 0));
      endDate = new Date(Date.UTC(selYear, selMonthIdx, daysInMonth, 23, 59, 59, 999));
      selectedMonth = `${selYear}-${String(selMonthIdx + 1).padStart(2, '0')}`;
      periodeLabel = new Date(Date.UTC(selYear, selMonthIdx, 1)).toLocaleDateString('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    }

    // Calculate Saturday count & target denominator per user requirements
    const totalSabtu = this.countSaturdays(startDate, endDate);
    let targetDenominator = 5;
    if (mode === 'weekly') {
      targetDenominator = 5;
    } else if (mode === 'monthly') {
      targetDenominator = totalSabtu * 5;
    } else if (mode === 'semester') {
      targetDenominator = totalSabtu * 6;
    } else if (mode === 'yearly') {
      targetDenominator = 12;
    }

    const emptyFilterOptions = {
      wilayahList: [] as Array<{ id: string; name: string }>,
      cabangList: [] as Array<{ id: string; name: string; wilayahId: string | null }>,
    };
    const empty = {
      tahunAjaran,
      semester,
      scopeLevel,
      unitLabel,
      selectedMonth,
      periodeLabel,
      totalSilabusCompleted: 0,
      totalSilabusTarget: 0,
      persenSilabus: 0,
      hadir: 0,
      totalAbsensi: 0,
      persenKehadiran: 0,
      kehadiranDelta: 0,
      persenPelajaranTerlaksana: 0,
      belumMulai: 0,
      statusDistribution: { optimal: 0, sesuaiJalur: 0, berisiko: 0 },
      breakdownTotal: 0,
      unitBreakdown: [] as Array<any>,
      filterOptions: emptyFilterOptions,
      kelasOptions: [] as Array<{ id: string; name: string }>,
      selectedKelasId: null as string | null,
      pemantauanMingguan: [] as Array<any>,
      weeksInfo: [] as Array<any>
    };
    if (!tahunAjaran || !semester) return empty;

    // ===== Resolve RBAC scope + user-selected filters =====
    let kelasWhere: any = {};
    if (scopeLevel === 'CABANG' && user.cabangId) {
      kelasWhere = { cabangId: user.cabangId };
    } else if (scopeLevel === 'WILAYAH' && user.wilayahId) {
      kelasWhere = { cabang: { wilayahId: user.wilayahId } };
      if (cabangId) kelasWhere = { cabangId, cabang: { wilayahId: user.wilayahId } };
    } else if (scopeLevel === 'GLOBAL') {
      if (cabangId) {
        kelasWhere = { cabangId };
      } else if (wilayahId) {
        kelasWhere = { cabang: { wilayahId } };
      }
    }

    const rawKelasList = await this.prisma.kelas.findMany({
      where: kelasWhere,
      include: {
        cabang: { include: { wilayah: true } },
        ruang: true,
        lembagaMuadalah: true,
        siswaFormal: {
          where: { student: { isActive: true } }
        }
      }
    });

    // Hide inactive classes (classes with 0 active students when breakdown is KELAS)
    const kelasList = (scopeLevel === 'CABANG' || breakdownLevel === 'KELAS')
      ? rawKelasList.filter(k => k.siswaFormal && k.siswaFormal.length > 0)
      : rawKelasList;

    const kelasIds = kelasList.map(k => k.id);
    const kelasById = new Map(kelasList.map(k => [k.id, k]));
    const tingkatSet = Array.from(new Set(kelasList.map(k => k.tingkat).filter((t): t is string => !!t)));

    // ===== Filter options (sesuai RBAC) =====
    const filterOptions = { ...emptyFilterOptions };
    if (scopeLevel === 'GLOBAL') {
      const wilayahSet = new Map<string, string>();
      const cabangSet = new Map<string, { id: string; name: string; wilayahId: string | null }>();
      kelasList.forEach(k => {
        if (k.cabang?.wilayah) wilayahSet.set(k.cabang.wilayahId!, k.cabang.wilayah.name);
        if (k.cabang) cabangSet.set(k.cabangId!, { id: k.cabangId!, name: k.cabang.name, wilayahId: k.cabang.wilayahId });
      });
      filterOptions.wilayahList = Array.from(wilayahSet.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      filterOptions.cabangList = Array.from(cabangSet.values())
        .sort((a, b) => a.name.localeCompare(b.name));
    } else if (scopeLevel === 'WILAYAH') {
      const cabangSet = new Map<string, { id: string; name: string; wilayahId: string | null }>();
      kelasList.forEach(k => {
        if (k.cabang) cabangSet.set(k.cabangId!, { id: k.cabangId!, name: k.cabang.name, wilayahId: k.cabang.wilayahId });
      });
      filterOptions.cabangList = Array.from(cabangSet.values())
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    // ===== Silabus & Pelaksanaan Data =====
    const silabusList = tingkatSet.length > 0 ? await this.prisma.silabusMapel.findMany({
      where: { tingkat: { in: tingkatSet }, tahunAjaran, semester, isActive: true, mataPelajaran: { aktifPembelajaran: true } },
      include: { mataPelajaran: true }
    }) : [];

    const pelaksanaanList = kelasIds.length > 0 ? await this.prisma.pelaksanaanSilabus.findMany({
      where: {
        kelasId: { in: kelasIds },
        tanggalDiajar: { gte: startDate, lte: endDate }
      },
      include: { silabus: { include: { mataPelajaran: true } }, mataPelajaran: true, guru: true }
    }) : [];

    const absensiList = kelasIds.length > 0 ? await this.prisma.absensiMapel.findMany({
      where: {
        kelasId: { in: kelasIds },
        tanggal: { gte: startDate, lte: endDate },
        mataPelajaran: { aktifPembelajaran: true }
      },
      include: { mataPelajaran: true, silabus: true }
    }) : [];

    // Weeks Info construction for table headers across startDate -> endDate
    const monthShortNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)));
    const weekCount = Math.max(1, Math.ceil(totalDays / 7));

    const weeksInfo = Array.from({ length: weekCount }, (_, weekIdx) => {
      const wStart = new Date(startDate.getTime() + weekIdx * 7 * 24 * 60 * 60 * 1000);
      const wEnd = new Date(Math.min(endDate.getTime(), wStart.getTime() + 6 * 24 * 60 * 60 * 1000));

      let satDay: Date | null = null;
      const curr = new Date(wStart);
      while (curr <= wEnd) {
        if (curr.getDay() === 6) {
          satDay = new Date(curr);
          break;
        }
        curr.setDate(curr.getDate() + 1);
      }

      const monthShort = monthShortNames[wStart.getMonth()] || '';
      const dayLabel = satDay
        ? `Sabtu, ${String(satDay.getDate()).padStart(2, '0')} ${monthShortNames[satDay.getMonth()]}`
        : `${wStart.getDate()}-${wEnd.getDate()} ${monthShort}`;

      return {
        weekNumber: weekIdx + 1,
        dateLabel: dayLabel,
        saturdayDate: satDay ? satDay.toISOString().split('T')[0] : null,
        startDateIso: wStart.toISOString(),
        endDateIso: wEnd.toISOString(),
        dateRange: `${wStart.getDate()}-${wEnd.getDate()} ${monthShort}`
      };
    });

    // ===== Unit breakdown =====
    type KelasT = (typeof kelasList)[number];
    type UnitAgg = {
      id: string; name: string; parentName: string;
      jumlahCabang: number; jumlahKelas: number; jumlahSiswa: number;
      silabusCompleted: number; silabusTotal: number;
      hadir: number; totalAbsensi: number;
      cabangSet: Set<string>; kelasSet: Set<string>;
      detailsMap: Map<string, any>;
    };
    const unitMap = new Map<string, UnitAgg>();
    const classToUnitIdMap = new Map<string, string>();

    const unitKeyOf = (kelas: KelasT): { id: string; name: string; parentName: string } => {
      if (breakdownLevel === 'WILAYAH') return {
        id: kelas.cabang?.wilayahId || 'unknown',
        name: kelas.cabang?.wilayah?.name || 'Tanpa Wilayah',
        parentName: ''
      };
      if (breakdownLevel === 'CABANG') return {
        id: kelas.cabangId || 'unknown',
        name: kelas.cabang?.name || 'Tanpa Cabang',
        parentName: kelas.cabang?.wilayah?.name || ''
      };
      return {
        id: kelas.id,
        name: kelas.name,
        parentName: kelas.cabang?.name || ''
      };
    };

    const ensureUnit = (kelas: KelasT) => {
      const key = unitKeyOf(kelas);
      classToUnitIdMap.set(kelas.id, key.id);

      if (!unitMap.has(key.id)) {
        unitMap.set(key.id, {
          id: key.id, name: key.name, parentName: key.parentName,
          jumlahCabang: 0, jumlahKelas: 0, jumlahSiswa: 0,
          silabusCompleted: 0, silabusTotal: 0,
          hadir: 0, totalAbsensi: 0,
          cabangSet: new Set(), kelasSet: new Set(),
          detailsMap: new Map()
        });
      }
      const u = unitMap.get(key.id)!;
      if (kelas.cabangId) u.cabangSet.add(kelas.cabangId);
      u.kelasSet.add(kelas.id);
      u.jumlahCabang = u.cabangSet.size;
      u.jumlahKelas = u.kelasSet.size;
      return u;
    };

    let totalSilabusCompleted = 0;
    let totalSilabusTarget = 0;

    kelasList.forEach(kelas => {
      if (!kelas.tingkat) return;
      const u = ensureUnit(kelas);
      const classStudents = kelas.siswaFormal ? kelas.siswaFormal.length : 0;
      u.jumlahSiswa += classStudents;

      // Count completed mapels in execution logs for this class
      const completedCount = pelaksanaanList.filter(
        p => p.kelasId === kelas.id && p.status === 'COMPLETED'
      ).length;

      u.silabusCompleted += completedCount;
      totalSilabusCompleted += completedCount;
    });

    unitMap.forEach(u => {
      u.silabusTotal = Math.max(1, u.jumlahKelas) * targetDenominator;
      totalSilabusTarget += u.silabusTotal;
    });

    absensiList.forEach(a => {
      const kelas = kelasById.get(a.kelasId);
      if (!kelas) return;
      const u = ensureUnit(kelas);
      u.totalAbsensi++;
      if (a.status === 'HADIR') u.hadir++;

      // Detail per mapel & tanggal untuk modal
      const mapelName = a.mataPelajaran?.name || 'Mata Pelajaran';
      const tglStr = a.tanggal.toISOString().split('T')[0];
      const dKey = `${a.mataPelajaranId}__${tglStr}`;

      if (!u.detailsMap.has(dKey)) {
        const pel = pelaksanaanList.find(p => p.kelasId === a.kelasId && p.mataPelajaranId === a.mataPelajaranId && p.tanggalDiajar && p.tanggalDiajar.toISOString().split('T')[0] === tglStr);
        u.detailsMap.set(dKey, {
          id: dKey,
          mataPelajaranId: a.mataPelajaranId,
          mataPelajaranName: mapelName,
          guruName: pel?.guru?.name || null,
          tanggal: tglStr,
          statusPelaksanaan: pel?.status || 'COMPLETED',
          hadir: 0,
          sakit: 0,
          izin: 0,
          alpa: 0,
          totalSiswa: u.jumlahSiswa || 1,
          persenHadirMapel: 0
        });
      }
      const d = u.detailsMap.get(dKey)!;
      if (a.status === 'HADIR') d.hadir++;
      else if (a.status === 'SAKIT') d.sakit++;
      else if (a.status === 'IZIN') d.izin++;
      else if (a.status === 'ALPA') d.alpa++;
    });

    // Finalize totalSiswa & persenHadirMapel for details
    Array.from(unitMap.values()).forEach(u => {
      Array.from(u.detailsMap.values()).forEach(d => {
        const recordedCount = d.hadir + d.sakit + d.izin + d.alpa;
        d.totalSiswa = Math.max(u.jumlahSiswa, recordedCount, 1);
        d.persenHadirMapel = Math.min(100, Math.round((d.hadir / d.totalSiswa) * 100));
      });
    });

    const statusDistribution = Array.from(unitMap.values())
      .map(u => this.statusForPercent(u.silabusTotal > 0 ? Math.round((u.silabusCompleted / u.silabusTotal) * 100) : 0))
      .reduce(
        (acc, status) => {
          if (status === 'Optimal') acc.optimal++;
          else if (status === 'Sesuai Jalur') acc.sesuaiJalur++;
          else acc.berisiko++;
          return acc;
        },
        { optimal: 0, sesuaiJalur: 0, berisiko: 0 }
      );

    const hadir = absensiList.filter(a => a.status === 'HADIR').length;
    const totalAbsensi = absensiList.length;
    const persenKehadiran = totalAbsensi > 0 ? Math.round((hadir / totalAbsensi) * 100) : 0;

    const pelaksanaanAktif = pelaksanaanList.filter(
      p => p.mataPelajaran?.aktifPembelajaran ?? p.silabus?.mataPelajaran.aktifPembelajaran ?? false
    );
    const pelaksanaanNonLibur = pelaksanaanAktif.filter(p => p.status !== 'LIBUR');
    const persenPelajaranTerlaksana = pelaksanaanNonLibur.length > 0
      ? Math.round((pelaksanaanNonLibur.filter(p => p.status === 'COMPLETED').length / pelaksanaanNonLibur.length) * 100)
      : 0;

    // Build unitBreakdown with multi-week breakdown array
    const unitBreakdown = Array.from(unitMap.values())
      .map(u => {
        const pctSilabus = u.silabusTotal > 0 ? Math.min(100, Math.round((u.silabusCompleted / u.silabusTotal) * 100)) : 0;
        const pctKehadiran = u.totalAbsensi > 0 ? Math.min(100, Math.round((u.hadir / u.totalAbsensi) * 100)) : 0;

        const details = Array.from(u.detailsMap.values()).sort((a, b) => b.tanggal.localeCompare(a.tanggal));

        // Weekly breakdown per week column
        const weeks = weeksInfo.map((wInfo, wIdx) => {
          const wStartDate = new Date(wInfo.startDateIso);
          wStartDate.setHours(0, 0, 0, 0);
          const wEndDate = new Date(wInfo.endDateIso);
          wEndDate.setHours(23, 59, 59, 999);
          const isFuture = wStartDate.getTime() > now.getTime();

          const isClassInUnit = (kId: string) => classToUnitIdMap.get(kId) === u.id;

          const wPel = pelaksanaanList.filter(
            p => isClassInUnit(p.kelasId) && p.tanggalDiajar && p.tanggalDiajar >= wStartDate && p.tanggalDiajar <= wEndDate && p.status === 'COMPLETED'
          );
          const wMapelCompleted = wPel.length;
          const wMapelTarget = Math.max(1, u.jumlahKelas) * 5;
          const wPersenMapel = isFuture ? 0 : Math.min(100, Math.round((wMapelCompleted / wMapelTarget) * 100));

          const wAbsAll = absensiList.filter(
            a => isClassInUnit(a.kelasId) && a.tanggal >= wStartDate && a.tanggal <= wEndDate
          );
          const wHadir = wAbsAll.filter(a => a.status === 'HADIR').length;
          const wTotalAbs = wAbsAll.length;
          const wPersenHadir = isFuture ? 0 : (wTotalAbs > 0 ? Math.min(100, Math.round((wHadir / wTotalAbs) * 100)) : 0);

          const wDetails = details.filter(d => {
            const dDate = new Date(d.tanggal);
            return dDate >= wStartDate && dDate <= wEndDate;
          });

          return {
            weekNumber: wIdx + 1,
            dateLabel: wInfo.dateLabel,
            isFuture,
            mapelCompleted: isFuture ? 0 : wMapelCompleted,
            mapelTarget: wMapelTarget,
            persenMapel: wPersenMapel,
            hadir: isFuture ? 0 : wHadir,
            totalAbsensi: wTotalAbs,
            persenKehadiran: wPersenHadir,
            details: wDetails
          };
        });

        return {
          id: u.id,
          name: u.name,
          parentName: u.parentName,
          jumlahCabang: u.jumlahCabang,
          jumlahKelas: u.jumlahKelas,
          jumlahSiswa: u.jumlahSiswa,
          silabusCompleted: u.silabusCompleted,
          silabusTotal: u.silabusTotal,
          persenSilabus: pctSilabus,
          hadir: u.hadir,
          totalAbsensi: u.totalAbsensi,
          persenKehadiran: pctKehadiran,
          status: this.statusForPercent(pctSilabus),
          weeks,
          details
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const kelasOptions = kelasList
      .map(k => ({ id: k.id, name: k.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      tahunAjaran,
      semester,
      scopeLevel,
      unitLabel,
      selectedMonth,
      periodeLabel,
      totalSilabusCompleted,
      totalSilabusTarget,
      persenSilabus: totalSilabusTarget > 0 ? Math.round((totalSilabusCompleted / totalSilabusTarget) * 100) : 0,
      hadir,
      totalAbsensi,
      persenKehadiran,
      kehadiranDelta: 0,
      persenPelajaranTerlaksana,
      belumMulai: 0,
      statusDistribution,
      breakdownTotal: unitBreakdown.length,
      unitBreakdown,
      filterOptions,
      kelasOptions,
      selectedKelasId: kelasId || null,
      pemantauanMingguan: [],
      weeksInfo
    };
  }
}
