import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { StatusSilabus, StatusKehadiranMapel } from '@prisma/client';

@Injectable()
export class PembelajaranService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // ===== A. Kelola Silabus (Admin Pusat) =====

  async getSilabus(params: { mataPelajaranId: string; tingkat: string; tahunAjaran: string; semester: string }) {
    const { mataPelajaranId, tingkat, tahunAjaran, semester } = params;
    return this.prisma.silabusMapel.findMany({
      where: { mataPelajaranId, tingkat, tahunAjaran, semester },
      orderBy: [{ urutanBab: 'asc' }, { urutanSection: 'asc' }]
    });
  }

  // Replace-in-place: baris yang punya `id` di-update, yang tanpa `id` dibuat baru,
  // baris lama untuk kombinasi mapel+tingkat+periode ini yang tidak lagi dikirim akan dihapus.
  async saveSilabusBulk(data: {
    mataPelajaranId: string;
    tingkat: string;
    tahunAjaran: string;
    semester: string;
    items: Array<{ id?: string; bab: string; urutanBab: number; section: string; urutanSection: number; tanggalTarget: string }>;
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
          tanggalTarget: new Date(item.tanggalTarget)
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

    const silabusList = await this.prisma.silabusMapel.findMany({
      where: { tingkat: kelas.tingkat, tahunAjaran, semester, isActive: true },
      include: { mataPelajaran: true },
      orderBy: [{ mataPelajaranId: 'asc' }, { urutanBab: 'asc' }, { urutanSection: 'asc' }]
    });

    const pelaksanaanList = await this.prisma.pelaksanaanSilabus.findMany({
      where: { kelasId, silabusId: { in: silabusList.map(s => s.id) } },
      include: { guru: true }
    });
    const pelaksanaanMap = new Map(pelaksanaanList.map(p => [p.silabusId, p]));

    // Guru default per mapel: siapa yang ditugaskan mengajar mapel ini di kelas ini
    // (dari Penugasan Guru / GuruMapelKelas) — dipakai kalau belum ada pengajar tersimpan.
    const mapelIds = Array.from(new Set(silabusList.map(s => s.mataPelajaranId)));
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

    // Section yang sudah punya minimal satu catatan AbsensiMapel di kelas ini dianggap "sudah absensi".
    const absensiSilabusIds = new Set(
      (await this.prisma.absensiMapel.findMany({
        where: { kelasId, silabusId: { in: silabusList.map(s => s.id) } },
        select: { silabusId: true },
        distinct: ['silabusId']
      })).map(a => a.silabusId)
    );

    const items = silabusList.map(s => {
      const p = pelaksanaanMap.get(s.id);
      const defaultGuru = defaultGuruMap.get(s.mataPelajaranId);
      return {
        silabusId: s.id,
        mataPelajaranId: s.mataPelajaranId,
        mataPelajaranName: s.mataPelajaran.name,
        bab: s.bab,
        section: s.section,
        tanggalTarget: s.tanggalTarget,
        status: p?.status || 'PENDING',
        tanggalDiajar: p?.tanggalDiajar || null,
        catatan: p?.catatan || '',
        guruId: p?.guruId || defaultGuru?.id || null,
        guruName: p?.guru?.name || defaultGuru?.name || null,
        hasAbsensi: absensiSilabusIds.has(s.id)
      };
    });

    return { items, guruOptions };
  }

  async savePelaksanaanBulk(
    kelasId: string,
    logs: Array<{ silabusId: string; status: StatusSilabus; tanggalDiajar?: string; catatan?: string; guruId?: string | null }>,
    userId?: string
  ) {
    return this.prisma.$transaction(
      logs.map(log =>
        this.prisma.pelaksanaanSilabus.upsert({
          where: { silabusId_kelasId: { silabusId: log.silabusId, kelasId } },
          update: {
            status: log.status,
            tanggalDiajar: log.tanggalDiajar ? new Date(log.tanggalDiajar) : null,
            catatan: log.catatan || null,
            guruId: log.guruId || null,
            updatedById: userId || null
          },
          create: {
            silabusId: log.silabusId,
            kelasId,
            status: log.status,
            tanggalDiajar: log.tanggalDiajar ? new Date(log.tanggalDiajar) : null,
            catatan: log.catatan || null,
            guruId: log.guruId || null,
            updatedById: userId || null
          }
        })
      )
    );
  }

  // ===== C. Absensi Siswa per Mapel (User Cabang) — direkam per baris silabus/materi =====

  async getAbsensiMapel(kelasId: string, silabusId: string) {
    const silabus = await this.prisma.silabusMapel.findUnique({
      where: { id: silabusId },
      include: { mataPelajaran: true }
    });
    if (!silabus) throw new NotFoundException('Section silabus tidak ditemukan');

    const pelaksanaan = await this.prisma.pelaksanaanSilabus.findUnique({
      where: { silabusId_kelasId: { silabusId, kelasId } }
    });

    const students = await this.prisma.student.findMany({
      where: { isActive: true, siswaFormal: { kelasId } },
      include: { biodata: { select: { fullName: true, nisLokal: true } } },
      orderBy: { biodata: { fullName: 'asc' } }
    });

    const existingLogs = await this.prisma.absensiMapel.findMany({
      where: { silabusId, kelasId, studentId: { in: students.map(s => s.id) } }
    });
    const logMap = new Map(existingLogs.map(l => [l.studentId, l]));

    return {
      mataPelajaranName: silabus.mataPelajaran.name,
      bab: silabus.bab,
      section: silabus.section,
      tanggalDefault: pelaksanaan?.tanggalDiajar || null,
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
            silabusId_kelasId_studentId: {
              silabusId,
              kelasId,
              studentId: log.studentId
            }
          },
          update: { tanggal: date, status: log.status, catatan: log.catatan || null },
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

  async getRingkasan(user: any) {
    const pengaturan = await this.prisma.pengaturanAkademik.findFirst();
    const tahunAjaran = pengaturan?.tahunAjaran || '';
    const semester = pengaturan?.semesterAktif || '';

    const scopeLevel: 'GLOBAL' | 'WILAYAH' | 'CABANG' =
      user?.scope === 'CABANG' ? 'CABANG' : user?.scope === 'WILAYAH' ? 'WILAYAH' : 'GLOBAL';
    const unitLabel = scopeLevel === 'GLOBAL' ? 'Wilayah' : scopeLevel === 'WILAYAH' ? 'Cabang' : 'Kelas';

    const empty = {
      tahunAjaran,
      semester,
      scopeLevel,
      unitLabel,
      totalSilabusCompleted: 0,
      totalSilabusTarget: 0,
      persenSilabus: 0,
      hadir: 0,
      totalAbsensi: 0,
      persenKehadiran: 0,
      belumMulai: 0,
      statusDistribution: { optimal: 0, sesuaiJalur: 0, berisiko: 0 },
      breakdown: [] as Array<{
        id: string; name: string; subtitle: string;
        persenSilabus: number; silabusCompleted: number; silabusTotal: number;
        persenKehadiran: number; hadir: number; totalAbsensi: number;
        status: 'Optimal' | 'Sesuai Jalur' | 'Berisiko';
      }>,
      breakdownTotal: 0,
      mapelBreakdown: [] as Array<{ mataPelajaranId: string; mataPelajaranName: string; persenSilabus: number; silabusCompleted: number; silabusTotal: number }>,
      pemantauanAbsensi: [] as Array<{
        kelasId: string; kelasName: string;
        mapel: Array<{ mataPelajaranId: string; mataPelajaranName: string; weeks: Array<{ hadir: number; total: number }> }>;
      }>,
      periodeAbsensiMingguan: '',
      aktivitasTerbaru: [] as Array<{
        id: string; kelasName: string; mataPelajaranName: string; bab: string; section: string;
        guruName: string | null; updatedAt: Date;
      }>
    };
    if (!tahunAjaran || !semester) return empty;

    let kelasWhere: any = {};
    if (scopeLevel === 'WILAYAH' && user.wilayahId) {
      kelasWhere = { cabang: { wilayahId: user.wilayahId } };
    } else if (scopeLevel === 'CABANG' && user.cabangId) {
      kelasWhere = { cabangId: user.cabangId };
    }

    const kelasList = await this.prisma.kelas.findMany({
      where: kelasWhere,
      include: { cabang: { include: { wilayah: true } } }
    });
    const kelasIds = kelasList.map(k => k.id);
    const kelasById = new Map(kelasList.map(k => [k.id, k]));
    const tingkatSet = Array.from(new Set(kelasList.map(k => k.tingkat).filter((t): t is string => !!t)));

    // Cocokkan silabus lewat label tahunAjaran+semester (persis seperti Kontrol Silabus /
    // getPelaksanaan), bukan lewat rentang tanggalTarget — supaya Dashboard selalu konsisten
    // dengan apa yang tampil & bisa ditandai di tab Kontrol Silabus, walau Pengaturan Akademik
    // telat diperbarui terhadap tanggal kalender riil.
    const silabusList = tingkatSet.length > 0 ? await this.prisma.silabusMapel.findMany({
      where: { tingkat: { in: tingkatSet }, tahunAjaran, semester, isActive: true },
      include: { mataPelajaran: true }
    }) : [];
    const pelaksanaanList = await this.prisma.pelaksanaanSilabus.findMany({
      where: { kelasId: { in: kelasIds }, silabusId: { in: silabusList.map(s => s.id) } }
    });
    const pelaksanaanMap = new Map(pelaksanaanList.map(p => [`${p.silabusId}__${p.kelasId}`, p]));

    // AbsensiMapel tidak punya kolom tahunAjaran/semester (hanya tanggal mentah), jadi seluruh
    // catatan pada kelas yang berada di lingkup RBAC ini dihitung apa adanya — tetap terhubung
    // dengan apa yang sudah diinput di tab Absensi Mapel tanpa syarat rentang tanggal tersembunyi.
    const absensiList = await this.prisma.absensiMapel.findMany({
      where: { kelasId: { in: kelasIds } }
    });

    type KelasT = (typeof kelasList)[number];
    type UnitAgg = {
      id: string; name: string; tingkat: string | null;
      silabusCompleted: number; silabusTotal: number; hadir: number; totalAbsensi: number;
      cabangIds: Set<string>; kelasIds: Set<string>;
    };
    const unitMap = new Map<string, UnitAgg>();
    const unitKeyOf = (kelas: KelasT): { id: string; name: string } => {
      if (scopeLevel === 'GLOBAL') return { id: kelas.cabang?.wilayahId || 'unknown', name: kelas.cabang?.wilayah?.name || 'Tanpa Wilayah' };
      if (scopeLevel === 'WILAYAH') return { id: kelas.cabangId || 'unknown', name: kelas.cabang?.name || 'Tanpa Cabang' };
      return { id: kelas.id, name: kelas.name };
    };
    const ensureUnit = (kelas: KelasT) => {
      const key = unitKeyOf(kelas);
      if (!unitMap.has(key.id)) {
        unitMap.set(key.id, {
          id: key.id, name: key.name, tingkat: kelas.tingkat,
          silabusCompleted: 0, silabusTotal: 0, hadir: 0, totalAbsensi: 0,
          cabangIds: new Set(), kelasIds: new Set()
        });
      }
      const u = unitMap.get(key.id)!;
      if (kelas.cabangId) u.cabangIds.add(kelas.cabangId);
      u.kelasIds.add(kelas.id);
      return u;
    };

    type MapelAgg = { id: string; name: string; completed: number; total: number };
    const mapelMap = new Map<string, MapelAgg>();
    const ensureMapel = (id: string, name: string) => {
      if (!mapelMap.has(id)) mapelMap.set(id, { id, name, completed: 0, total: 0 });
      return mapelMap.get(id)!;
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
        const m = ensureMapel(s.mataPelajaranId, s.mataPelajaran.name);
        m.total++;
        if (status === 'COMPLETED') {
          u.silabusCompleted++;
          totalSilabusCompleted++;
          m.completed++;
        }
      });
      if (!anyRecord) belumMulai++;
    });

    let hadir = 0;
    let totalAbsensi = 0;
    absensiList.forEach(a => {
      const kelas = kelasById.get(a.kelasId);
      if (!kelas) return;
      const u = ensureUnit(kelas);
      u.totalAbsensi++;
      totalAbsensi++;
      if (a.status === 'HADIR') {
        u.hadir++;
        hadir++;
      }
    });

    const breakdownFull = Array.from(unitMap.values())
      .map(u => {
        const persenSilabus = u.silabusTotal > 0 ? Math.round((u.silabusCompleted / u.silabusTotal) * 100) : 0;
        const persenKehadiran = u.totalAbsensi > 0 ? Math.round((u.hadir / u.totalAbsensi) * 100) : 0;
        return {
          id: u.id,
          name: u.name,
          subtitle:
            scopeLevel === 'GLOBAL' ? `${u.cabangIds.size} cabang`
              : scopeLevel === 'WILAYAH' ? `${u.kelasIds.size} kelas`
                : `Tingkat ${u.tingkat || '-'}`,
          persenSilabus,
          silabusCompleted: u.silabusCompleted,
          silabusTotal: u.silabusTotal,
          persenKehadiran,
          hadir: u.hadir,
          totalAbsensi: u.totalAbsensi,
          status: this.statusForPercent(persenSilabus)
        };
      })
      .sort((a, b) => a.persenSilabus - b.persenSilabus);

    const statusDistribution = breakdownFull.reduce(
      (acc, r) => {
        if (r.status === 'Optimal') acc.optimal++;
        else if (r.status === 'Sesuai Jalur') acc.sesuaiJalur++;
        else acc.berisiko++;
        return acc;
      },
      { optimal: 0, sesuaiJalur: 0, berisiko: 0 }
    );

    const mapelBreakdown = Array.from(mapelMap.values())
      .map(m => ({
        mataPelajaranId: m.id,
        mataPelajaranName: m.name,
        persenSilabus: m.total > 0 ? Math.round((m.completed / m.total) * 100) : 0,
        silabusCompleted: m.completed,
        silabusTotal: m.total
      }))
      .sort((a, b) => a.persenSilabus - b.persenSilabus)
      .slice(0, 12);

    // Pemantauan Absensi mingguan (kelas × mapel × minggu-dalam-bulan-berjalan) — hanya untuk
    // scope CABANG, karena jumlah kelasnya kecil & inilah audiens yang butuh detail sedetail ini.
    // Untuk WILAYAH/GLOBAL, panel "breakdown" per unit di atas sudah cukup mewakili tanpa
    // membanjiri layar dengan ratusan baris kelas.
    type WeekCell = { hadir: number; total: number };
    type MapelWeekRow = { mataPelajaranId: string; mataPelajaranName: string; weeks: WeekCell[] };
    let pemantauanAbsensi: Array<{ kelasId: string; kelasName: string; mapel: MapelWeekRow[] }> = [];
    let periodeAbsensiMingguan = '';

    if (scopeLevel === 'CABANG' && kelasIds.length > 0) {
      const now = new Date();
      const year = now.getUTCFullYear();
      const monthIdx = now.getUTCMonth();
      const daysInMonth = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
      const weekCount = Math.ceil(daysInMonth / 7);
      const monthStart = new Date(Date.UTC(year, monthIdx, 1));
      const monthEnd = new Date(Date.UTC(year, monthIdx, daysInMonth, 23, 59, 59, 999));
      periodeAbsensiMingguan = now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' });

      const absensiBulanIni = await this.prisma.absensiMapel.findMany({
        where: { kelasId: { in: kelasIds }, tanggal: { gte: monthStart, lte: monthEnd } },
        include: { mataPelajaran: true }
      });

      const kelasBlockMap = new Map<string, { kelasName: string; mapelMap: Map<string, MapelWeekRow> }>();
      absensiBulanIni.forEach(a => {
        const weekIdx = Math.min(weekCount - 1, Math.floor((a.tanggal.getUTCDate() - 1) / 7));
        if (!kelasBlockMap.has(a.kelasId)) {
          kelasBlockMap.set(a.kelasId, { kelasName: kelasById.get(a.kelasId)?.name || '-', mapelMap: new Map() });
        }
        const block = kelasBlockMap.get(a.kelasId)!;
        if (!block.mapelMap.has(a.mataPelajaranId)) {
          block.mapelMap.set(a.mataPelajaranId, {
            mataPelajaranId: a.mataPelajaranId,
            mataPelajaranName: a.mataPelajaran.name,
            weeks: Array.from({ length: weekCount }, () => ({ hadir: 0, total: 0 }))
          });
        }
        const mapelAcc = block.mapelMap.get(a.mataPelajaranId)!;
        mapelAcc.weeks[weekIdx].total++;
        if (a.status === 'HADIR') mapelAcc.weeks[weekIdx].hadir++;
      });

      pemantauanAbsensi = Array.from(kelasBlockMap.entries())
        .map(([kelasId, block]) => ({
          kelasId,
          kelasName: block.kelasName,
          mapel: Array.from(block.mapelMap.values()).sort((a, b) => a.mataPelajaranName.localeCompare(b.mataPelajaranName))
        }))
        .sort((a, b) => a.kelasName.localeCompare(b.kelasName));
    }

    const recentPelaksanaan = await this.prisma.pelaksanaanSilabus.findMany({
      where: { status: 'COMPLETED', kelas: kelasWhere },
      orderBy: { updatedAt: 'desc' },
      take: 8,
      include: {
        silabus: { include: { mataPelajaran: true } },
        kelas: true,
        guru: true
      }
    });

    return {
      tahunAjaran,
      semester,
      scopeLevel,
      unitLabel,
      totalSilabusCompleted,
      totalSilabusTarget,
      persenSilabus: totalSilabusTarget > 0 ? Math.round((totalSilabusCompleted / totalSilabusTarget) * 100) : 0,
      hadir,
      totalAbsensi,
      persenKehadiran: totalAbsensi > 0 ? Math.round((hadir / totalAbsensi) * 100) : 0,
      belumMulai,
      statusDistribution,
      breakdown: breakdownFull.slice(0, 12),
      breakdownTotal: breakdownFull.length,
      mapelBreakdown,
      pemantauanAbsensi,
      periodeAbsensiMingguan,
      aktivitasTerbaru: recentPelaksanaan.map(p => ({
        id: p.id,
        kelasName: p.kelas.name,
        mataPelajaranName: p.silabus.mataPelajaran.name,
        bab: p.silabus.bab,
        section: p.silabus.section,
        guruName: p.guru?.name || null,
        updatedAt: p.updatedAt
      }))
    };
  }
}
