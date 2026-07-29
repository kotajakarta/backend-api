import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';

const matchSubject = (subjectName: string | undefined | null, subKey: string) => {
  if (!subjectName) return false;
  const nameLower = subjectName.toLowerCase().trim();
  if (nameLower === subKey) return true;
  if (nameLower.includes(subKey)) return true;
  if (subKey === 'pkn' && (nameLower.includes('pancasila') || nameLower.includes('kewarganegaraan'))) return true;
  return false;
};

@Injectable()
export class DashboardService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getStats(user: any, query: any = {}) {
    let whereClause: any = {};
    const { wilayahId, cabangId, jenisKelamin } = query;

    if (user.scope === 'WILAYAH') {
      whereClause.wilayahId = user.wilayahId;
    } else if (user.scope === 'CABANG') {
      whereClause.cabangId = user.cabangId;
    }

    if (wilayahId && user.scope === 'GLOBAL') {
      whereClause.wilayahId = wilayahId;
    }
    if (cabangId && (user.scope === 'GLOBAL' || user.scope === 'WILAYAH')) {
      whereClause.cabangId = cabangId;
    }

    const studentWhere: any = { isActive: true, ...whereClause };
    if (jenisKelamin) {
      studentWhere.biodata = { jenisKelamin };
    }

    const totalSantri = await this.prisma.student.count({
      where: studentWhere
    });

    // 1. Chart Grup Daimi
    const allGrupDaimi = ['HAZIRLIK', 'HAFIZLIK', 'IBTIDAI', 'IHZARI', 'No. Grup'];
    const grupDaimiGroup = await this.prisma.student.groupBy({
      by: ['grupDaimi'],
      _count: {
        id: true,
      },
      where: studentWhere
    });

    const chartGrupDaimi = allGrupDaimi.map(grup => {
      let count = 0;
      if (grup === 'No. Grup') {
        const found = grupDaimiGroup.find(g => g.grupDaimi === null);
        count = found ? found._count.id : 0;
      } else {
        const found = grupDaimiGroup.find(g => g.grupDaimi === grup);
        count = found ? found._count.id : 0;
      }
      return {
        name: grup,
        value: count
      };
    });

    // 2. Chart Statistik Tambahan (Tingkat 7-12 & Non Muadalah)
    const nonMuadalahCount = await this.prisma.student.count({
      where: {
        ...studentWhere,
        OR: [{ jenisSiswa: { not: 'MUADALAH' } }, { jenisSiswa: null }]
      }
    });

    const siswaFormalList = await this.prisma.siswaFormal.findMany({
      where: { student: studentWhere },
      include: { kelas: true }
    });

    const tingkatCounts = {
      '7': 0, '8': 0, '9': 0, '10': 0, '11': 0, '12': 0
    };

    siswaFormalList.forEach(sf => {
      if (sf.kelas) {
        const t = sf.kelas.tingkat || sf.kelas.name || '';
        const tUpper = t.toUpperCase();
        if (tUpper.includes('12') || tUpper.includes('XII')) tingkatCounts['12']++;
        else if (tUpper.includes('11') || tUpper.includes('XI')) tingkatCounts['11']++;
        else if (tUpper.includes('10') || tUpper.includes('X')) tingkatCounts['10']++;
        else if (tUpper.includes('9') || tUpper.includes('IX')) tingkatCounts['9']++;
        else if (tUpper.includes('8') || tUpper.includes('VIII')) tingkatCounts['8']++;
        else if (tUpper.includes('7') || tUpper.includes('VII')) tingkatCounts['7']++;
      }
    });

    const chartStatistikTambahan = [
      { name: '7', value: tingkatCounts['7'] },
      { name: '8', value: tingkatCounts['8'] },
      { name: '9', value: tingkatCounts['9'] },
      { name: '10', value: tingkatCounts['10'] },
      { name: '11', value: tingkatCounts['11'] },
      { name: '12', value: tingkatCounts['12'] },
      { name: 'Non Muadalah', value: nonMuadalahCount }
    ];

    const kelasWhere: any = { isActive: true };
    if (cabangId) {
      kelasWhere.cabangId = cabangId;
    } else if (wilayahId) {
      kelasWhere.cabang = { wilayahId };
    } else {
      if (user.scope === 'WILAYAH') kelasWhere.cabang = { wilayahId: user.wilayahId };
      else if (user.scope === 'CABANG') kelasWhere.cabangId = user.cabangId;
    }

    const totalKelas = await this.prisma.kelas.count({
      where: kelasWhere
    });

    // Subject coverage logic
    const requiredSubjects = ['matematika', 'bahasa indonesia', 'bahasa inggris', 'ipa', 'pkn'];
    
    const cabangWhere: any = {};
    if (cabangId) {
      cabangWhere.id = cabangId;
    } else if (wilayahId) {
      cabangWhere.wilayahId = wilayahId;
    } else {
      if (user.scope === 'WILAYAH') cabangWhere.wilayahId = user.wilayahId;
      else if (user.scope === 'CABANG') cabangWhere.id = user.cabangId;
    }

    const cabangs = await this.prisma.cabang.findMany({
      where: cabangWhere,
      include: {
        wilayah: { select: { name: true } },
        kelas: {
          where: { isActive: true },
          include: {
            guruMapelKelas: {
              include: {
                mataPelajaran: true
              }
            }
          }
        }
      },
      orderBy: [
        { wilayahId: 'asc' },
        { name: 'asc' }
      ]
    });

    const ketersediaanGuru = [];
    for (const cabang of cabangs) {
      const missing = [];
      if (cabang.kelas.length > 0) {
        for (const sub of requiredSubjects) {
          let hasTeacherInAllClasses = true;
          for (const k of cabang.kelas) {
            const hasTeacher = k.guruMapelKelas.some(
              gmk => matchSubject(gmk.mataPelajaran?.name, sub)
            );
            if (!hasTeacher) {
              hasTeacherInAllClasses = false;
              break;
            }
          }
          if (!hasTeacherInAllClasses) {
            missing.push(sub);
          }
        }
      } else {
        missing.push(...requiredSubjects);
      }
      let status = 'hijau';
      if (missing.length === requiredSubjects.length) {
        status = 'merah';
      } else if (missing.length > 0) {
        status = 'kuning';
      }

      ketersediaanGuru.push({
        cabangId: cabang.id,
        cabangName: cabang.name,
        wilayahName: cabang.wilayah?.name || 'Pusat/Lainnya',
        missingSubjects: missing,
        status
      });
    }

    const activityWhere: any = {};
    if (cabangId) {
      activityWhere.cabangId = cabangId;
    } else if (wilayahId) {
      activityWhere.wilayahId = wilayahId;
    } else {
      if (user.scope === 'WILAYAH') activityWhere.wilayahId = user.wilayahId;
      else if (user.scope === 'CABANG') activityWhere.cabangId = user.cabangId;
    }

    const recentLogs = await this.prisma.auditLog.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      where: activityWhere
    });

    const activities = recentLogs.map((log: any) => ({
      title: log.details,
      time: log.createdAt.toISOString(),
      author: log.actorName || 'Sistem'
    }));

    // Progres Cetak Rapor Muadalah untuk TA/Semester aktif (hanya relevan bagi divisi Formal)
    let raporCetakProgress: {
      tahunAjaran: string;
      semester: string;
      sudahCetak: number;
      total: number;
      percent: number;
    } | null = null;

    if (user.divisi === 'FORMAL' || user.divisi === 'ALL') {
      const pengaturanAkademik = await this.prisma.pengaturanAkademik.findFirst();
      if (pengaturanAkademik?.tahunAjaran && pengaturanAkademik?.semesterAktif) {
        const taAktif = pengaturanAkademik.tahunAjaran;
        const semAktif = pengaturanAkademik.semesterAktif;

        let kelasWhereRapor: any = {};
        if (user.scope === 'CABANG' && user.cabangId) {
          kelasWhereRapor = { cabangId: user.cabangId };
        } else if (user.scope === 'WILAYAH' && user.wilayahId) {
          kelasWhereRapor = { cabang: { wilayahId: user.wilayahId } };
        }

        const siswaFormalIds = await this.prisma.siswaFormal.findMany({
          where: { kelas: kelasWhereRapor },
          select: { studentId: true }
        });
        const totalRapor = siswaFormalIds.length;
        const sudahCetakCount = totalRapor === 0 ? 0 : await this.prisma.riwayatKelasFormal.count({
          where: {
            studentId: { in: siswaFormalIds.map(s => s.studentId) },
            tahunAjaran: taAktif,
            semester: semAktif,
            sudahCetak: true
          }
        });

        raporCetakProgress = {
          tahunAjaran: taAktif,
          semester: semAktif,
          sudahCetak: sudahCetakCount,
          total: totalRapor,
          percent: totalRapor > 0 ? Math.round((sudahCetakCount / totalRapor) * 100) : 0
        };
      }
    }

    // Kelengkapan Data Siswa
    const totalSantriWithFullData = await this.prisma.student.count({
      where: {
        ...studentWhere,
        biodata: {
          ...(studentWhere.biodata || {}),
          nik: { not: null },
          noKk: { not: null },
          nisn: { not: null },
          tempatLahir: { not: null },
          tanggalLahir: { not: null },
          namaAyah: { not: null }
        }
      }
    });

    const kelengkapanSiswa = {
      total: totalSantri,
      lengkap: totalSantriWithFullData,
      percent: totalSantri > 0 ? Math.round((totalSantriWithFullData / totalSantri) * 100) : 0
    };

    // Kelengkapan Data Guru
    const staffWhere: any = { statusPool: 'TERSEDIA' };
    if (cabangWhere.id) staffWhere.cabangId = cabangWhere.id;
    else if (cabangWhere.wilayahId) staffWhere.wilayahId = cabangWhere.wilayahId;

    const totalGuru = await this.prisma.staff.count({ where: staffWhere });
    const totalGuruLengkap = await this.prisma.staff.count({
      where: {
        ...staffWhere,
        phone: { not: null },
        ktpUrl: { not: null }
      }
    });

    const kelengkapanGuru = {
      total: totalGuru,
      lengkap: totalGuruLengkap,
      percent: totalGuru > 0 ? Math.round((totalGuruLengkap / totalGuru) * 100) : 0
    };

    return {
      totalSantri,
      totalKelas,
      cabangMissingSubjectsCount: ketersediaanGuru.filter(k => k.status !== 'hijau').length,
      ketersediaanGuru,
      chartGrupDaimi,
      chartKelas: chartStatistikTambahan,
      activities,
      raporCetakProgress,
      kelengkapanSiswa,
      kelengkapanGuru
    };
  }

  async getKetersediaanGuruDetail(user: any) {
    const requiredSubjects = ['matematika', 'bahasa indonesia', 'bahasa inggris', 'ipa', 'pkn'];

    const cabangs = await this.prisma.cabang.findMany({
      where: user.scope === 'GLOBAL'
        ? {}
        : user.scope === 'WILAYAH'
          ? { wilayahId: user.wilayahId }
          : { id: user.cabangId },
      include: {
        wilayah: { select: { id: true, name: true } },
        kelas: {
          where: { isActive: true },
          orderBy: { name: 'asc' },
          include: {
            guruMapelKelas: {
              include: {
                mataPelajaran: { select: { id: true, name: true } },
                staff: { select: { id: true, name: true } }
              }
            }
          }
        }
      },
      orderBy: [{ wilayahId: 'asc' }, { name: 'asc' }]
    });

    const result = [];

    for (const cabang of cabangs) {
      const kelasDetail = [];

      for (const kelas of cabang.kelas) {
        const subjectCoverage = requiredSubjects.map(sub => {
          const assignment = kelas.guruMapelKelas.find(
            gmk => matchSubject(gmk.mataPelajaran?.name, sub)
          );
          return {
            mapel: sub,
            hasGuru: !!assignment,
            guruName: assignment?.staff?.name || null,
            guruId: assignment?.staff?.id || null,
          };
        });

        const missingCount = subjectCoverage.filter(s => !s.hasGuru).length;
        kelasDetail.push({
          kelasId: kelas.id,
          kelasName: kelas.name,
          tingkat: kelas.tingkat || null,
          subjectCoverage,
          missingCount,
          status: missingCount === 0 ? 'lengkap' : missingCount === requiredSubjects.length ? 'kosong' : 'sebagian'
        });
      }

      const totalMissing = kelasDetail.reduce((sum, k) => sum + k.missingCount, 0);
      const hasAnyCoverage = kelasDetail.some(k => k.missingCount < requiredSubjects.length);
      const isAllCovered = kelasDetail.length > 0 && kelasDetail.every(k => k.missingCount === 0);

      result.push({
        cabangId: cabang.id,
        cabangName: cabang.name,
        wilayahId: cabang.wilayah?.id || null,
        wilayahName: cabang.wilayah?.name || 'Pusat/Lainnya',
        totalKelas: cabang.kelas.length,
        totalMissingSlots: totalMissing,
        status: isAllCovered ? 'hijau' : hasAnyCoverage ? 'kuning' : 'merah',
        kelas: kelasDetail
      });
    }

    return result;
  }
}
