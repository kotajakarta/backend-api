import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { StatusSilabus, StatusKehadiranMapel } from '@prisma/client';

export interface SilabusSummaryItem {
  mataPelajaranId: string;
  name: string;
  kodeMapel: string;
  jumlahItem: number;
  hasSilabus: boolean;
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

  // Ringkasan per mapel aktif untuk satu Tingkat+TahunAjaran+Semester: dipakai layar
  // daftar Kelola Silabus agar admin tahu mapel mana yang silabusnya sudah/belum diisi.
  async getSilabusSummary(params: { tingkat: string; tahunAjaran: string; semester: string }): Promise<SilabusSummaryItem[]> {
    const { tingkat, tahunAjaran, semester } = params;

    const [mapelList, grouped] = await Promise.all([
      this.prisma.mataPelajaran.findMany({
        where: { aktifPembelajaran: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, kodeMapel: true }
      }),
      this.prisma.silabusMapel.groupBy({
        by: ['mataPelajaranId'],
        where: { tingkat, tahunAjaran, semester },
        _count: { _all: true }
      })
    ]);

    const countByMapel = new Map(grouped.map(g => [g.mataPelajaranId, g._count._all]));

    return mapelList.map(m => ({
      mataPelajaranId: m.id,
      name: m.name,
      kodeMapel: m.kodeMapel,
      jumlahItem: countByMapel.get(m.id) ?? 0,
      hasSilabus: (countByMapel.get(m.id) ?? 0) > 0
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
      select: { silabusId: true, tanggal: true, status: true }
    }) : [];
    const absensiSet = new Set(absensiList.map(a => `${a.silabusId}__${a.tanggal.toISOString().slice(0, 10)}`));

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
        hasAbsensi: p.silabusId && tglStr ? absensiSet.has(`${p.silabusId}__${tglStr}`) : false
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
            silabusId_kelasId_studentId_tanggal: {
              silabusId,
              kelasId,
              studentId: log.studentId,
              tanggal: date
            }
          },
          update: { status: log.status, catatan: log.catatan || null },
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
      const start = new Date(params.weekStart);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
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
      include: { cabang: { include: { wilayah: true } } }
    });
    const kelasIds = kelasList.map(k => k.id);
    const tingkatSet = Array.from(new Set(kelasList.map(k => k.tingkat).filter((t): t is string => !!t)));

    // Mode 'semester' cocokkan silabus lewat label tahunAjaran+semester persis seperti Kontrol
    // Silabus (getPelaksanaan) — bukan lewat rentang tanggalTarget, supaya tidak "putus" kalau
    // Pengaturan Akademik telat diperbarui terhadap tanggal kalender riil. Mode weekly/monthly
    // memang butuh jendela tanggal karena tidak ada label periode eksplisit untuk dicocokkan.
    const silabusList = await this.prisma.silabusMapel.findMany({
      where: {
        tingkat: { in: tingkatSet },
        isActive: true,
        mataPelajaran: { aktifPembelajaran: true },
        ...(filters.mode === 'semester'
          ? { tahunAjaran: filters.tahunAjaran, semester: filters.semester }
          : { tanggalTarget: dateRange }),
        ...(filters.mataPelajaranId ? { mataPelajaranId: filters.mataPelajaranId } : {})
      }
    });
    const pelaksanaanList = await this.prisma.pelaksanaanSilabus.findMany({
      where: { kelasId: { in: kelasIds }, silabusId: { in: silabusList.map(s => s.id) } }
    });
    const pelaksanaanMap = new Map(pelaksanaanList.map(p => [`${p.silabusId}__${p.kelasId}`, p]));

    // AbsensiMapel tidak punya kolom tahunAjaran/semester (hanya tanggal mentah), jadi untuk
    // mode 'semester' kita hitung semua catatan yang ada di kelas terkait (tanpa batas tanggal)
    // supaya selalu terhubung dengan apa yang sudah diinput di tab Absensi Mapel.
    const absensiList = await this.prisma.absensiMapel.findMany({
      where: {
        kelasId: { in: kelasIds },
        mataPelajaran: { aktifPembelajaran: true },
        ...(filters.mode === 'semester' ? {} : { tanggal: dateRange }),
        ...(filters.mataPelajaranId ? { mataPelajaranId: filters.mataPelajaranId } : {})
      }
    });
    const kelasById = new Map(kelasList.map(k => [k.id, k]));

    type CabangAgg = {
      cabangId: string;
      cabangName: string;
      wilayahName: string;
      silabusCompleted: number;
      silabusTotal: number;
      hadir: number;
      totalAbsensi: number;
    };
    const cabangMap = new Map<string, CabangAgg>();
    const ensureCabang = (kelas: (typeof kelasList)[number]) => {
      const id = kelas.cabangId || 'unknown';
      if (!cabangMap.has(id)) {
        cabangMap.set(id, {
          cabangId: id,
          cabangName: kelas.cabang?.name || 'Tanpa Cabang',
          wilayahName: kelas.cabang?.wilayah?.name || '-',
          silabusCompleted: 0,
          silabusTotal: 0,
          hadir: 0,
          totalAbsensi: 0
        });
      }
      return cabangMap.get(id)!;
    };

    kelasList.forEach(kelas => {
      if (!kelas.tingkat) return;
      silabusList
        .filter(s => s.tingkat === kelas.tingkat)
        .forEach(s => {
          const p = pelaksanaanMap.get(`${s.id}__${kelas.id}`);
          const status = p?.status || 'PENDING';
          if (status === 'LIBUR') return;
          const entry = ensureCabang(kelas);
          entry.silabusTotal++;
          if (status === 'COMPLETED') entry.silabusCompleted++;
        });
    });

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
      persenSilabus: e.silabusTotal > 0 ? Math.round((e.silabusCompleted / e.silabusTotal) * 100) : 0,
      silabusCompleted: e.silabusCompleted,
      silabusTotal: e.silabusTotal,
      persenKehadiran: e.totalAbsensi > 0 ? Math.round((e.hadir / e.totalAbsensi) * 100) : 0,
      hadir: e.hadir,
      totalAbsensi: e.totalAbsensi
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

  private statusForPercent(pct: number): 'Optimal' | 'Sesuai Jalur' | 'Berisiko' {
    return pct >= 90 ? 'Optimal' : pct >= 70 ? 'Sesuai Jalur' : 'Berisiko';
  }

  async getRingkasan(user: any, month?: string, kelasId?: string, wilayahId?: string, cabangId?: string) {
    const pengaturan = await this.prisma.pengaturanAkademik.findFirst();
    const tahunAjaran = pengaturan?.tahunAjaran || '';
    const semester = pengaturan?.semesterAktif || '';

    const scopeLevel: 'GLOBAL' | 'WILAYAH' | 'CABANG' =
      user?.scope === 'CABANG' ? 'CABANG' : user?.scope === 'WILAYAH' ? 'WILAYAH' : 'GLOBAL';
    const unitLabel = scopeLevel === 'GLOBAL' ? 'Wilayah' : scopeLevel === 'WILAYAH' ? 'Cabang' : 'Kelas';

    const now = new Date();
    const validMonth = month && /^\d{4}-\d{2}$/.test(month);
    const selYear = validMonth ? parseInt(month!.slice(0, 4)) : now.getUTCFullYear();
    const selMonthIdx = validMonth ? parseInt(month!.slice(5, 7)) - 1 : now.getUTCMonth();
    const selectedMonth = `${selYear}-${String(selMonthIdx + 1).padStart(2, '0')}`;
    const periodeLabel = new Date(Date.UTC(selYear, selMonthIdx, 1)).toLocaleDateString('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' });

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
      unitBreakdown: [] as Array<{
        id: string; name: string; parentName: string;
        silabusCompleted: number; silabusTotal: number; persenSilabus: number;
        hadir: number; totalAbsensi: number; persenKehadiran: number;
        status: 'Optimal' | 'Sesuai Jalur' | 'Berisiko';
      }>,
      filterOptions: emptyFilterOptions,
      kelasOptions: [] as Array<{ id: string; name: string }>,
      selectedKelasId: null as string | null,
      pemantauanMingguan: [] as Array<{
        mataPelajaranId: string; mataPelajaranName: string;
        weeks: Array<{
          hadir: number; sakit: number; izin: number; alpa: number; total: number;
          status: 'PENDING' | 'COMPLETED' | 'LIBUR' | null; guruNames: string[]; kelasNames: string[];
          details?: Array<{
            kelasId: string; kelasName: string; guruName?: string | null;
            status: 'PENDING' | 'COMPLETED' | 'LIBUR' | null;
            hadir: number; sakit: number; izin: number; alpa: number; total: number;
          }>;
        }>;
      }>
    };
    if (!tahunAjaran || !semester) return empty;

    // ===== Resolve RBAC scope + user-selected filters =====
    // RBAC narrows the base scope; wilayahId/cabangId further drill down within that scope.
    let kelasWhere: any = {};
    if (scopeLevel === 'CABANG' && user.cabangId) {
      kelasWhere = { cabangId: user.cabangId };
    } else if (scopeLevel === 'WILAYAH' && user.wilayahId) {
      kelasWhere = { cabang: { wilayahId: user.wilayahId } };
      // Drill-down into specific cabang within wilayah
      if (cabangId) kelasWhere = { cabangId, cabang: { wilayahId: user.wilayahId } };
    } else if (scopeLevel === 'GLOBAL') {
      // Drill-down into specific wilayah or cabang
      if (cabangId) {
        kelasWhere = { cabangId };
      } else if (wilayahId) {
        kelasWhere = { cabang: { wilayahId } };
      }
    }

    const kelasList = await this.prisma.kelas.findMany({
      where: kelasWhere,
      include: { cabang: { include: { wilayah: true } }, ruang: true, lembagaMuadalah: true }
    });
    const kelasIds = kelasList.map(k => k.id);
    const kelasById = new Map(kelasList.map(k => [k.id, k]));
    const tingkatSet = Array.from(new Set(kelasList.map(k => k.tingkat).filter((t): t is string => !!t)));

    // ===== Build filter options (sesuai RBAC) =====
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

    // ===== Silabus data =====
    const silabusList = tingkatSet.length > 0 ? await this.prisma.silabusMapel.findMany({
      where: { tingkat: { in: tingkatSet }, tahunAjaran, semester, isActive: true, mataPelajaran: { aktifPembelajaran: true } },
      include: { mataPelajaran: true }
    }) : [];
    const pelaksanaanList = await this.prisma.pelaksanaanSilabus.findMany({
      where: { kelasId: { in: kelasIds }, silabusId: { in: silabusList.map(s => s.id) } }
    });
    const pelaksanaanMap = new Map(pelaksanaanList.map(p => [`${p.silabusId}__${p.kelasId}`, p]));

    // ===== Unit breakdown — now tracks kehadiran too =====
    type KelasT = (typeof kelasList)[number];
    type UnitAgg = {
      id: string; name: string; parentName: string;
      silabusCompleted: number; silabusTotal: number;
      hadir: number; totalAbsensi: number;
    };
    const unitMap = new Map<string, UnitAgg>();
    const unitKeyOf = (kelas: KelasT): { id: string; name: string; parentName: string } => {
      if (scopeLevel === 'GLOBAL') return {
        id: kelas.cabang?.wilayahId || 'unknown',
        name: kelas.cabang?.wilayah?.name || 'Tanpa Wilayah',
        parentName: ''
      };
      if (scopeLevel === 'WILAYAH') return {
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
      if (!unitMap.has(key.id)) {
        unitMap.set(key.id, {
          id: key.id, name: key.name, parentName: key.parentName,
          silabusCompleted: 0, silabusTotal: 0,
          hadir: 0, totalAbsensi: 0
        });
      }
      return unitMap.get(key.id)!;
    };

    let totalSilabusCompleted = 0;
    let totalSilabusTarget = 0;
    let belumMulai = 0;

    kelasList.forEach(kelas => {
      if (!kelas.tingkat) return;
      const applicable = silabusList.filter(s => s.tingkat === kelas.tingkat);
      if (applicable.length === 0) return;
      let anyRecord = false;
      applicable.forEach(s => {
        const p = pelaksanaanMap.get(`${s.id}__${kelas.id}`);
        if (p) anyRecord = true;
        const status = p?.status || 'PENDING';
        if (status === 'LIBUR') return;
        const u = ensureUnit(kelas);
        u.silabusTotal++;
        totalSilabusTarget++;
        if (status === 'COMPLETED') {
          u.silabusCompleted++;
          totalSilabusCompleted++;
        }
      });
      if (!anyRecord) belumMulai++;
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

    // ===== Monthly section =====
    const daysInMonth = new Date(Date.UTC(selYear, selMonthIdx + 1, 0)).getUTCDate();
    const weekCount = Math.ceil(daysInMonth / 7);
    const monthStart = new Date(Date.UTC(selYear, selMonthIdx, 1));
    const monthEnd = new Date(Date.UTC(selYear, selMonthIdx, daysInMonth, 23, 59, 59, 999));

    const prevMonthIdx = selMonthIdx === 0 ? 11 : selMonthIdx - 1;
    const prevYear = selMonthIdx === 0 ? selYear - 1 : selYear;
    const prevDaysInMonth = new Date(Date.UTC(prevYear, prevMonthIdx + 1, 0)).getUTCDate();
    const prevMonthStart = new Date(Date.UTC(prevYear, prevMonthIdx, 1));
    const prevMonthEnd = new Date(Date.UTC(prevYear, prevMonthIdx, prevDaysInMonth, 23, 59, 59, 999));

    const kelasOptions = kelasList
      .map(k => ({ id: k.id, name: k.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const selectedKelasId = kelasId && kelasIds.includes(kelasId) ? kelasId : null;
    const gridKelasIds = selectedKelasId ? [selectedKelasId] : kelasIds;

    const [absensiBulanIni, absensiBulanLalu, pelaksanaanBulanIni] = await Promise.all([
      this.prisma.absensiMapel.findMany({
        where: { kelasId: { in: gridKelasIds }, tanggal: { gte: monthStart, lte: monthEnd }, mataPelajaran: { aktifPembelajaran: true } },
        include: { mataPelajaran: true }
      }),
      this.prisma.absensiMapel.findMany({
        where: { kelasId: { in: gridKelasIds }, tanggal: { gte: prevMonthStart, lte: prevMonthEnd }, mataPelajaran: { aktifPembelajaran: true } },
        select: { status: true }
      }),
      this.prisma.pelaksanaanSilabus.findMany({
        where: { kelasId: { in: gridKelasIds }, tanggalDiajar: { gte: monthStart, lte: monthEnd } },
        include: { silabus: { include: { mataPelajaran: true } }, mataPelajaran: true, guru: true }
      })
    ]);

    const hadir = absensiBulanIni.filter(a => a.status === 'HADIR').length;
    const totalAbsensi = absensiBulanIni.length;
    const persenKehadiran = totalAbsensi > 0 ? Math.round((hadir / totalAbsensi) * 100) : 0;

    const hadirBulanLalu = absensiBulanLalu.filter(a => a.status === 'HADIR').length;
    const persenKehadiranBulanLalu = absensiBulanLalu.length > 0 ? Math.round((hadirBulanLalu / absensiBulanLalu.length) * 100) : 0;
    const kehadiranDelta = absensiBulanLalu.length > 0 ? persenKehadiran - persenKehadiranBulanLalu : 0;

    // Track kehadiran per unit (for unitBreakdown)
    absensiBulanIni.forEach(a => {
      const kelas = kelasById.get(a.kelasId);
      if (!kelas) return;
      const u = ensureUnit(kelas);
      u.totalAbsensi++;
      if (a.status === 'HADIR') u.hadir++;
    });

    const pelaksanaanAktif = pelaksanaanBulanIni.filter(
      p => p.mataPelajaran?.aktifPembelajaran ?? p.silabus?.mataPelajaran.aktifPembelajaran ?? false
    );
    const pelaksanaanNonLibur = pelaksanaanAktif.filter(p => p.status !== 'LIBUR');
    const persenPelajaranTerlaksana = pelaksanaanNonLibur.length > 0
      ? Math.round((pelaksanaanNonLibur.filter(p => p.status === 'COMPLETED').length / pelaksanaanNonLibur.length) * 100)
      : 0;

    // Build unitBreakdown array
    const unitBreakdown = Array.from(unitMap.values())
      .map(u => {
        const pctSilabus = u.silabusTotal > 0 ? Math.round((u.silabusCompleted / u.silabusTotal) * 100) : 0;
        const pctKehadiran = u.totalAbsensi > 0 ? Math.round((u.hadir / u.totalAbsensi) * 100) : 0;
        return {
          id: u.id,
          name: u.name,
          parentName: u.parentName,
          silabusCompleted: u.silabusCompleted,
          silabusTotal: u.silabusTotal,
          persenSilabus: pctSilabus,
          hadir: u.hadir,
          totalAbsensi: u.totalAbsensi,
          persenKehadiran: pctKehadiran,
          status: this.statusForPercent(pctSilabus)
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    // ===== Weekly monitoring =====
    type ClassWeekDetail = {
      kelasId: string; kelasName: string; guruName?: string | null;
      status: 'PENDING' | 'COMPLETED' | 'LIBUR' | null;
      hadir: number; sakit: number; izin: number; alpa: number; total: number;
    };
    type WeekCell = {
      hadir: number; sakit: number; izin: number; alpa: number; total: number;
      status: 'PENDING' | 'COMPLETED' | 'LIBUR' | null; guruNames: string[]; kelasNames: string[];
      details?: ClassWeekDetail[];
      detailsMap?: Map<string, ClassWeekDetail>;
    };
    type MapelWeekRow = { mataPelajaranId: string; mataPelajaranName: string; weeks: WeekCell[] };

    const emptyWeekCell = (): WeekCell => ({
      hadir: 0, sakit: 0, izin: 0, alpa: 0, total: 0, status: null,
      guruNames: [], kelasNames: [], detailsMap: new Map<string, ClassWeekDetail>()
    });
    const mapelWeekMap = new Map<string, MapelWeekRow>();
    const ensureMapelWeekRow = (mataPelajaranId: string, mataPelajaranName: string) => {
      if (!mapelWeekMap.has(mataPelajaranId)) {
        mapelWeekMap.set(mataPelajaranId, { mataPelajaranId, mataPelajaranName, weeks: Array.from({ length: weekCount }, emptyWeekCell) });
      }
      return mapelWeekMap.get(mataPelajaranId)!;
    };

    absensiBulanIni.forEach(a => {
      const weekIdx = Math.min(weekCount - 1, Math.floor((a.tanggal.getUTCDate() - 1) / 7));
      const cell = ensureMapelWeekRow(a.mataPelajaranId, a.mataPelajaran.name).weeks[weekIdx];
      cell.total++;
      if (a.status === 'HADIR') cell.hadir++;
      else if (a.status === 'SAKIT') cell.sakit++;
      else if (a.status === 'IZIN') cell.izin++;
      else if (a.status === 'ALPA') cell.alpa++;

      const kName = kelasById.get(a.kelasId)?.name;
      if (kName && !cell.kelasNames.includes(kName)) cell.kelasNames.push(kName);

      // Detail per kelas
      let d = cell.detailsMap!.get(a.kelasId);
      if (!d) {
        d = { kelasId: a.kelasId, kelasName: kName || 'Kelas', guruName: null, status: null, hadir: 0, sakit: 0, izin: 0, alpa: 0, total: 0 };
        cell.detailsMap!.set(a.kelasId, d);
      }
      d.total++;
      if (a.status === 'HADIR') d.hadir++;
      else if (a.status === 'SAKIT') d.sakit++;
      else if (a.status === 'IZIN') d.izin++;
      else if (a.status === 'ALPA') d.alpa++;
    });

    const STATUS_PRIORITY: Record<string, number> = { PENDING: 2, COMPLETED: 1, LIBUR: 0 };
    pelaksanaanAktif.forEach(p => {
      if (!p.tanggalDiajar) return;
      const mapelId = p.mataPelajaranId || p.silabus?.mataPelajaranId;
      const mapelName = p.mataPelajaran?.name || p.silabus?.mataPelajaran.name;
      if (!mapelId || !mapelName) return;
      const weekIdx = Math.min(weekCount - 1, Math.floor((p.tanggalDiajar.getUTCDate() - 1) / 7));
      const cell = ensureMapelWeekRow(mapelId, mapelName).weeks[weekIdx];
      if (!cell.status || STATUS_PRIORITY[p.status] > STATUS_PRIORITY[cell.status]) {
        cell.status = p.status;
      }
      if (p.guru?.name && !cell.guruNames.includes(p.guru.name)) cell.guruNames.push(p.guru.name);

      const kName = kelasById.get(p.kelasId)?.name;
      if (kName && !cell.kelasNames.includes(kName)) cell.kelasNames.push(kName);

      // Detail per kelas
      let d = cell.detailsMap!.get(p.kelasId);
      if (!d) {
        d = { kelasId: p.kelasId, kelasName: kName || 'Kelas', guruName: p.guru?.name || null, status: p.status, hadir: 0, sakit: 0, izin: 0, alpa: 0, total: 0 };
        cell.detailsMap!.set(p.kelasId, d);
      } else {
        if (p.guru?.name) d.guruName = p.guru.name;
        if (!d.status || STATUS_PRIORITY[p.status] > STATUS_PRIORITY[d.status]) {
          d.status = p.status;
        }
      }
    });

    // Transform detailsMap into details array for API output
    Array.from(mapelWeekMap.values()).forEach(row => {
      row.weeks.forEach(cell => {
        if (cell.detailsMap) {
          cell.details = Array.from(cell.detailsMap.values()).sort((a, b) => a.kelasName.localeCompare(b.kelasName));
          delete cell.detailsMap;
        }
      });
    });

    const pemantauanMingguan = Array.from(mapelWeekMap.values()).sort((a, b) => a.mataPelajaranName.localeCompare(b.mataPelajaranName));

    const monthShortNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const monthShort = monthShortNames[selMonthIdx] || '';
    const weeksInfo = Array.from({ length: weekCount }, (_, weekIdx) => {
      const startDay = weekIdx * 7 + 1;
      const endDay = Math.min(daysInMonth, (weekIdx + 1) * 7);
      let satDay: number | null = null;
      for (let d = startDay; d <= endDay; d++) {
        const dateObj = new Date(Date.UTC(selYear, selMonthIdx, d));
        if (dateObj.getUTCDay() === 6) {
          satDay = d;
          break;
        }
      }
      const dayLabel = satDay !== null ? `Sabtu, ${satDay} ${monthShort}` : `${startDay}-${endDay} ${monthShort}`;
      return {
        weekNumber: weekIdx + 1,
        dateLabel: dayLabel,
        saturdayDate: satDay ? `${selYear}-${String(selMonthIdx + 1).padStart(2, '0')}-${String(satDay).padStart(2, '0')}` : null,
        dateRange: `${startDay}-${endDay} ${monthShort}`
      };
    });

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
      kehadiranDelta,
      persenPelajaranTerlaksana,
      belumMulai,
      statusDistribution,
      breakdownTotal: unitMap.size,
      unitBreakdown,
      filterOptions,
      kelasOptions,
      selectedKelasId,
      pemantauanMingguan,
      weeksInfo
    };
  }
}
