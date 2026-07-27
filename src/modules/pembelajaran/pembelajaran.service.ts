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
        guruName: p?.guru?.name || defaultGuru?.name || null
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

  // ===== C. Absensi Siswa per Mapel (User Cabang) =====

  async getAbsensiMapel(kelasId: string, mataPelajaranId: string, tanggal: string) {
    const students = await this.prisma.student.findMany({
      where: { isActive: true, siswaFormal: { kelasId } },
      include: { biodata: { select: { fullName: true, nisLokal: true } } },
      orderBy: { biodata: { fullName: 'asc' } }
    });

    const date = new Date(tanggal);
    const existingLogs = await this.prisma.absensiMapel.findMany({
      where: { kelasId, mataPelajaranId, tanggal: date, studentId: { in: students.map(s => s.id) } }
    });
    const logMap = new Map(existingLogs.map(l => [l.studentId, l]));

    return students.map(student => {
      const log = logMap.get(student.id);
      return {
        studentId: student.id,
        fullName: student.biodata.fullName,
        nisLokal: student.biodata.nisLokal,
        status: log?.status || 'HADIR',
        catatan: log?.catatan || ''
      };
    });
  }

  async saveAbsensiMapelBulk(
    kelasId: string,
    mataPelajaranId: string,
    tanggal: string,
    logs: Array<{ studentId: string; status: StatusKehadiranMapel; catatan?: string }>
  ) {
    const date = new Date(tanggal);
    return this.prisma.$transaction(
      logs.map(log =>
        this.prisma.absensiMapel.upsert({
          where: {
            mataPelajaranId_kelasId_studentId_tanggal: {
              mataPelajaranId,
              kelasId,
              studentId: log.studentId,
              tanggal: date
            }
          },
          update: { status: log.status, catatan: log.catatan || null },
          create: {
            mataPelajaranId,
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

    // Silabus: ambil semua section dengan tanggal target dalam rentang, lalu terapkan
    // ke tiap kelas yang tingkatnya cocok (section yang belum pernah disentuh user cabang
    // dianggap PENDING, tetap masuk pembagi persentase).
    const silabusList = await this.prisma.silabusMapel.findMany({
      where: {
        tingkat: { in: tingkatSet },
        tanggalTarget: dateRange,
        isActive: true,
        ...(filters.mataPelajaranId ? { mataPelajaranId: filters.mataPelajaranId } : {})
      }
    });
    const pelaksanaanList = await this.prisma.pelaksanaanSilabus.findMany({
      where: { kelasId: { in: kelasIds }, silabusId: { in: silabusList.map(s => s.id) } }
    });
    const pelaksanaanMap = new Map(pelaksanaanList.map(p => [`${p.silabusId}__${p.kelasId}`, p]));

    const absensiList = await this.prisma.absensiMapel.findMany({
      where: {
        kelasId: { in: kelasIds },
        tanggal: dateRange,
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

  // ===== E. Ringkasan (Dashboard) — semua scope, terpotong ke lingkup masing-masing =====

  async getRingkasan(user: any) {
    const pengaturan = await this.prisma.pengaturanAkademik.findFirst();
    const tahunAjaran = pengaturan?.tahunAjaran || '';
    const semester = pengaturan?.semesterAktif || '';

    const empty = {
      tahunAjaran,
      semester,
      totalSilabusCompleted: 0,
      totalSilabusTarget: 0,
      persenSilabus: 0,
      hadir: 0,
      totalAbsensi: 0,
      persenKehadiran: 0,
      cabangCount: 0,
      rekap: [] as Awaited<ReturnType<PembelajaranService['getLaporan']>>['rekap'],
      aktivitasTerbaru: [] as Array<{
        id: string;
        kelasName: string;
        mataPelajaranName: string;
        bab: string;
        section: string;
        guruName: string | null;
        updatedAt: Date;
      }>
    };
    if (!tahunAjaran || !semester) return empty;

    const { rekap } = await this.getLaporan({ mode: 'semester', tahunAjaran, semester }, user);

    const totalSilabusCompleted = rekap.reduce((s, r) => s + r.silabusCompleted, 0);
    const totalSilabusTarget = rekap.reduce((s, r) => s + r.silabusTotal, 0);
    const hadir = rekap.reduce((s, r) => s + r.hadir, 0);
    const totalAbsensi = rekap.reduce((s, r) => s + r.totalAbsensi, 0);

    let kelasWhere: any = {};
    if (user?.scope === 'CABANG' && user.cabangId) {
      kelasWhere = { cabangId: user.cabangId };
    } else if (user?.scope === 'WILAYAH' && user.wilayahId) {
      kelasWhere = { cabang: { wilayahId: user.wilayahId } };
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
      totalSilabusCompleted,
      totalSilabusTarget,
      persenSilabus: totalSilabusTarget > 0 ? Math.round((totalSilabusCompleted / totalSilabusTarget) * 100) : 0,
      hadir,
      totalAbsensi,
      persenKehadiran: totalAbsensi > 0 ? Math.round((hadir / totalAbsensi) * 100) : 0,
      cabangCount: rekap.length,
      rekap,
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
