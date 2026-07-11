import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';

@Injectable()
export class DashboardService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getStats(user: any) {
    let whereClause = {};

    if (user.scope === 'WILAYAH') {
      whereClause = { wilayahId: user.wilayahId };
    } else if (user.scope === 'CABANG') {
      whereClause = { cabangId: user.cabangId };
    }

    const totalSantri = await this.prisma.student.count({
      where: user.scope === 'GLOBAL' ? {} : whereClause
    });

    // 1. Chart Grup Daimi
    const allGrupDaimi = ['HAZIRLIK', 'HAFIZLIK', 'IBTIDAI', 'IHZARI', 'No. Grup'];
    const grupDaimiGroup = await this.prisma.student.groupBy({
      by: ['grupDaimi'],
      _count: {
        id: true,
      },
      where: user.scope === 'GLOBAL' ? { isActive: true } : { ...whereClause, isActive: true }
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
      where: user.scope === 'GLOBAL' 
        ? { isActive: true, OR: [{ jenisSiswa: { not: 'MUADALAH' } }, { jenisSiswa: null }] } 
        : { ...whereClause, isActive: true, OR: [{ jenisSiswa: { not: 'MUADALAH' } }, { jenisSiswa: null }] }
    });

    const siswaFormalList = await this.prisma.siswaFormal.findMany({
      where: user.scope === 'GLOBAL' ? { student: { isActive: true } } : { student: { ...whereClause, isActive: true } },
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

    const totalKelas = await this.prisma.kelas.count({
      where: user.scope === 'GLOBAL' 
        ? {} 
        : user.scope === 'WILAYAH' 
          ? { cabang: { wilayahId: user.wilayahId } }
          : { cabangId: user.cabangId }
    });

    // Subject coverage logic
    const requiredSubjects = ['matematika', 'bahasa indonesia', 'bahasa inggris', 'ipa', 'pkn'];
    
    // Fetch cabangs based on scope
    const cabangs = await this.prisma.cabang.findMany({
      where: user.scope === 'GLOBAL' 
        ? {} 
        : user.scope === 'WILAYAH' 
          ? { wilayahId: user.wilayahId }
          : { id: user.cabangId },
      include: {
        wilayah: { select: { name: true } },
        kelas: {
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
              gmk => gmk.mataPelajaran?.name?.toLowerCase() === sub
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

    // Fetch real activities from AuditLog
    const recentLogs = await this.prisma.auditLog.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      where: user.scope === 'GLOBAL' 
        ? {} 
        : user.scope === 'WILAYAH' 
          ? { wilayahId: user.wilayahId }
          : { cabangId: user.cabangId }
    });

    const activities = recentLogs.map((log: any) => ({
      title: log.details,
      time: log.createdAt.toISOString(),
      author: log.actorName || 'Sistem'
    }));

    return {
      totalSantri,
      totalKelas,
      cabangMissingSubjectsCount: ketersediaanGuru.filter(k => k.status !== 'hijau').length,
      ketersediaanGuru,
      chartGrupDaimi,
      chartKelas: chartStatistikTambahan,
      activities
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
            gmk => gmk.mataPelajaran?.name?.toLowerCase() === sub
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
