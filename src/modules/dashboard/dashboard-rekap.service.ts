import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
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
export class DashboardRekapService {
  private readonly logger = new Logger(DashboardRekapService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // Nightly cron job to reconcile all dashboard aggregation scopes
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleDailyReconciliation() {
    this.logger.log('Starting daily RekapDashboardUtama reconciliation cron...');
    try {
      await this.syncAllRekap();
      this.logger.log('RekapDashboardUtama reconciliation finished successfully.');
    } catch (err: any) {
      this.logger.error(`Error in RekapDashboardUtama reconciliation: ${err?.message}`, err?.stack);
    }
  }

  // Sync Global and all Wilayah and Cabang scopes
  async syncAllRekap() {
    this.logger.log('Syncing GLOBAL rekap...');
    await this.computeAndSaveForScope('GLOBAL', 'GLOBAL');

    const wilayahList = await this.prisma.wilayah.findMany({ select: { id: true, name: true } });
    this.logger.log(`Syncing ${wilayahList.length} Wilayah rekaps...`);
    for (const w of wilayahList) {
      await this.computeAndSaveForScope(`WILAYAH_${w.id}`, 'WILAYAH', w.id);
    }

    const cabangList = await this.prisma.cabang.findMany({ select: { id: true, name: true } });
    this.logger.log(`Syncing ${cabangList.length} Cabang rekaps...`);
    for (const c of cabangList) {
      await this.computeAndSaveForScope(`CABANG_${c.id}`, 'CABANG', c.id);
    }

    return {
      syncedGlobal: 1,
      syncedWilayah: wilayahList.length,
      syncedCabang: cabangList.length,
      timestamp: new Date().toISOString()
    };
  }

  // Compute aggregation for a specific scope and save into rekap_dashboard_utama
  async computeAndSaveForScope(scopeKey: string, scopeType: 'GLOBAL' | 'WILAYAH' | 'CABANG', entityId?: string) {
    try {
      const studentWhere: any = { isActive: true };
      const kelasWhere: any = { isActive: true };
      const cabangWhere: any = {};
      const staffWhere: any = { statusPool: 'AKTIF_CABANG' };

      if (scopeType === 'WILAYAH' && entityId) {
        studentWhere.wilayahId = entityId;
        kelasWhere.cabang = { wilayahId: entityId };
        cabangWhere.wilayahId = entityId;
        staffWhere.wilayahId = entityId;
      } else if (scopeType === 'CABANG' && entityId) {
        studentWhere.cabangId = entityId;
        kelasWhere.cabangId = entityId;
        cabangWhere.id = entityId;
        staffWhere.cabangId = entityId;
      }

      // 1. Total Santri
      const totalSantri = await this.prisma.student.count({ where: studentWhere });

      // 2. Chart Distribusi Grup Daimi
      const masterJenisList = await this.prisma.jenisGrupDaimi.findMany({
        orderBy: { createdAt: 'asc' }
      });
      const activeGrupDaimiList = await this.prisma.grupDaimi.findMany({
        select: { id: true, name: true, jenis: true }
      });

      const categoryNamesSet = new Set<string>();
      if (masterJenisList.length > 0) {
        masterJenisList.forEach(j => {
          if (j.name && j.name.trim()) categoryNamesSet.add(j.name.trim().toUpperCase());
        });
      } else {
        ['HAZIRLIK', 'HAFIZLIK', 'IBTIDAI', 'IHZARI'].forEach(c => categoryNamesSet.add(c));
      }

      activeGrupDaimiList.forEach(g => {
        if (g.jenis && g.jenis.trim()) categoryNamesSet.add(g.jenis.trim().toUpperCase());
      });

      const categoryList = Array.from(categoryNamesSet);
      const countsMap = new Map<string, number>();
      categoryList.forEach(cat => countsMap.set(cat, 0));
      countsMap.set('NO_GRUP', 0);

      const studentsWithDaimi = await this.prisma.student.findMany({
        where: studentWhere,
        select: {
          id: true,
          grupDaimi: true,
          dataDaimi: {
            select: {
              grup: {
                select: { name: true, jenis: true }
              }
            }
          }
        }
      });

      studentsWithDaimi.forEach(s => {
        const rawCat = s.dataDaimi?.grup?.jenis || s.dataDaimi?.grup?.name || s.grupDaimi;
        if (!rawCat || !rawCat.trim() || rawCat === '-' || rawCat.toLowerCase().includes('tanpa') || rawCat.toLowerCase().includes('no.')) {
          countsMap.set('NO_GRUP', (countsMap.get('NO_GRUP') || 0) + 1);
        } else {
          const upperRaw = rawCat.trim().toUpperCase();
          let matchedCategory = categoryList.find(c => upperRaw === c);
          if (!matchedCategory) {
            matchedCategory = categoryList.find(c => upperRaw.includes(c) || c.includes(upperRaw));
          }

          if (matchedCategory) {
            countsMap.set(matchedCategory, (countsMap.get(matchedCategory) || 0) + 1);
          } else {
            if (!countsMap.has(upperRaw)) countsMap.set(upperRaw, 0);
            countsMap.set(upperRaw, (countsMap.get(upperRaw) || 0) + 1);
          }
        }
      });

      const chartGrupDaimi: { name: string; value: number }[] = [];
      countsMap.forEach((val, key) => {
        const displayName = key === 'NO_GRUP' ? 'No. Grup' : key;
        chartGrupDaimi.push({ name: displayName, value: val });
      });

      // 3. Tingkat Formal
      const siswaFormalList = await this.prisma.siswaFormal.findMany({
        where: { student: studentWhere },
        include: { kelas: true }
      });

      const tingkatCounts = { '7': 0, '8': 0, '9': 0, '10': 0, '11': 0, '12': 0 };
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

      const totalSantriFormal = tingkatCounts['7'] + tingkatCounts['8'] + tingkatCounts['9'] + tingkatCounts['10'] + tingkatCounts['11'] + tingkatCounts['12'];
      const nonMuadalahCount = Math.max(0, totalSantri - totalSantriFormal);

      const chartStatistikTambahan = [
        { name: '7', value: tingkatCounts['7'] },
        { name: '8', value: tingkatCounts['8'] },
        { name: '9', value: tingkatCounts['9'] },
        { name: '10', value: tingkatCounts['10'] },
        { name: '11', value: tingkatCounts['11'] },
        { name: '12', value: tingkatCounts['12'] },
        { name: 'Non Muadalah', value: nonMuadalahCount }
      ];

      // 4. Total Kelas
      const totalKelas = await this.prisma.kelas.count({ where: kelasWhere });

      // 5. Ketersediaan Guru Mapel
      const requiredSubjects = ['matematika', 'bahasa indonesia', 'bahasa inggris', 'ipa', 'pkn'];
      const cabangs = await this.prisma.cabang.findMany({
        where: cabangWhere,
        select: {
          id: true,
          name: true,
          wilayahId: true,
          wilayah: { select: { name: true } },
          kelas: {
            where: { isActive: true },
            select: {
              id: true,
              guruMapelKelas: {
                select: {
                  mataPelajaran: { select: { name: true } }
                }
              }
            }
          }
        },
        orderBy: [{ wilayahId: 'asc' }, { name: 'asc' }]
      });

      const ketersediaanGuru: any[] = [];
      for (const c of cabangs) {
        const missing: string[] = [];
        if (c.kelas.length > 0) {
          for (const sub of requiredSubjects) {
            let hasTeacherInAllClasses = true;
            for (const k of c.kelas) {
              const hasTeacher = k.guruMapelKelas.some(gmk => matchSubject(gmk.mataPelajaran?.name, sub));
              if (!hasTeacher) {
                hasTeacherInAllClasses = false;
                break;
              }
            }
            if (!hasTeacherInAllClasses) missing.push(sub);
          }
        } else {
          missing.push(...requiredSubjects);
        }
        let status = 'hijau';
        if (missing.length === requiredSubjects.length) status = 'merah';
        else if (missing.length > 0) status = 'kuning';

        ketersediaanGuru.push({
          cabangId: c.id,
          cabangName: c.name,
          wilayahName: c.wilayah?.name || 'Pusat/Lainnya',
          missingSubjects: missing,
          status
        });
      }

      // 6. Progres Cetak Rapor
      let raporCetakProgress: any = null;
      const pengaturanAkademik = await this.prisma.pengaturanAkademik.findFirst();
      const taAktif = pengaturanAkademik?.tahunAjaran || '';
      const semAktif = pengaturanAkademik?.semesterAktif || '';

      if (taAktif && semAktif) {
        let kelasWhereRapor: any = {};
        if (scopeType === 'CABANG' && entityId) {
          kelasWhereRapor = { cabangId: entityId };
        } else if (scopeType === 'WILAYAH' && entityId) {
          kelasWhereRapor = { cabang: { wilayahId: entityId } };
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

      // 7. Kelengkapan Data Siswa & Guru
      const fullDataBiodataCondition = {
        nik: { not: null },
        noKk: { not: null },
        nisn: { not: null },
        tempatLahir: { not: null },
        tanggalLahir: { not: null },
        namaAyah: { not: null }
      };

      const guruLengkapCondition = {
        phone: { not: null },
        ktpUrl: { not: null }
      };

      const totalSantriWithFullData = await this.prisma.student.count({
        where: {
          ...studentWhere,
          biodata: { ...(studentWhere.biodata || {}), ...fullDataBiodataCondition }
        }
      });

      const kelengkapanSiswa = {
        total: totalSantri,
        lengkap: totalSantriWithFullData,
        percent: totalSantri > 0 ? Math.round((totalSantriWithFullData / totalSantri) * 100) : 0
      };

      const totalGuru = await this.prisma.staff.count({ where: staffWhere });
      const totalGuruLengkap = await this.prisma.staff.count({
        where: { ...staffWhere, ...guruLengkapCondition }
      });

      const kelengkapanGuru = {
        total: totalGuru,
        lengkap: totalGuruLengkap,
        percent: totalGuru > 0 ? Math.round((totalGuruLengkap / totalGuru) * 100) : 0
      };

      // 8. Kelengkapan Entities
      const kelengkapanEntities: any[] = [];
      if (scopeType === 'GLOBAL') {
        const wilayahs = await this.prisma.wilayah.findMany({ orderBy: { name: 'asc' } });
        for (const w of wilayahs) {
          const total = await this.prisma.student.count({
            where: { ...studentWhere, wilayahId: w.id }
          });
          const lengkap = total === 0 ? 0 : await this.prisma.student.count({
            where: { ...studentWhere, wilayahId: w.id, biodata: { ...(studentWhere.biodata || {}), ...fullDataBiodataCondition } }
          });
          const totG = await this.prisma.staff.count({
            where: { statusPool: 'AKTIF_CABANG', wilayahId: w.id }
          });
          const lenG = totG === 0 ? 0 : await this.prisma.staff.count({
            where: { statusPool: 'AKTIF_CABANG', wilayahId: w.id, ...guruLengkapCondition }
          });

          kelengkapanEntities.push({
            name: w.name,
            siswa: { total, lengkap, percent: total > 0 ? Math.round((lengkap / total) * 100) : 0 },
            guru: { total: totG, lengkap: lenG, percent: totG > 0 ? Math.round((lenG / totG) * 100) : 0 }
          });
        }
      } else if (scopeType === 'WILAYAH' && entityId) {
        const cabangsInWil = await this.prisma.cabang.findMany({
          where: { wilayahId: entityId },
          select: { id: true, name: true },
          orderBy: { name: 'asc' }
        });
        for (const c of cabangsInWil) {
          const total = await this.prisma.student.count({
            where: { ...studentWhere, cabangId: c.id }
          });
          const lengkap = total === 0 ? 0 : await this.prisma.student.count({
            where: { ...studentWhere, cabangId: c.id, biodata: { ...(studentWhere.biodata || {}), ...fullDataBiodataCondition } }
          });
          const totG = await this.prisma.staff.count({
            where: { statusPool: 'AKTIF_CABANG', cabangId: c.id }
          });
          const lenG = totG === 0 ? 0 : await this.prisma.staff.count({
            where: { statusPool: 'AKTIF_CABANG', cabangId: c.id, ...guruLengkapCondition }
          });

          kelengkapanEntities.push({
            name: c.name,
            siswa: { total, lengkap, percent: total > 0 ? Math.round((lengkap / total) * 100) : 0 },
            guru: { total: totG, lengkap: lenG, percent: totG > 0 ? Math.round((lenG / totG) * 100) : 0 }
          });
        }
      } else if (scopeType === 'CABANG' && entityId) {
        const kelasList = await this.prisma.kelas.findMany({
          where: { cabangId: entityId, isActive: true },
          orderBy: { name: 'asc' }
        });
        for (const k of kelasList) {
          const total = await this.prisma.student.count({
            where: {
              ...studentWhere,
              riwayatKelasFormal: { some: { kelasId: k.id, tahunAjaran: taAktif, semester: semAktif } }
            }
          });
          const lengkap = total === 0 ? 0 : await this.prisma.student.count({
            where: {
              ...studentWhere,
              riwayatKelasFormal: { some: { kelasId: k.id, tahunAjaran: taAktif, semester: semAktif } },
              biodata: { ...(studentWhere.biodata || {}), ...fullDataBiodataCondition }
            }
          });
          kelengkapanEntities.push({
            name: k.name,
            siswa: { total, lengkap, percent: total > 0 ? Math.round((lengkap / total) * 100) : 0 }
          });
        }

        const totalBelum = await this.prisma.student.count({
          where: {
            ...studentWhere,
            riwayatKelasFormal: { none: { tahunAjaran: taAktif, semester: semAktif } }
          }
        });
        if (totalBelum > 0) {
          const lengkapBelum = await this.prisma.student.count({
            where: {
              ...studentWhere,
              riwayatKelasFormal: { none: { tahunAjaran: taAktif, semester: semAktif } },
              biodata: { ...(studentWhere.biodata || {}), ...fullDataBiodataCondition }
            }
          });
          kelengkapanEntities.push({
            name: 'Belum Masuk Kelas',
            siswa: { total: totalBelum, lengkap: lengkapBelum, percent: Math.round((lengkapBelum / totalBelum) * 100) }
          });
        }
      }

      const extraData = {
        totalGuru,
        cabangMissingSubjectsCount: ketersediaanGuru.filter(k => k.status !== 'hijau').length,
        raporCetakProgress,
        kelengkapanSiswa,
        kelengkapanGuru,
        kelengkapanEntities
      };

      const record = await this.prisma.rekapDashboardUtama.upsert({
        where: { scopeKey },
        update: {
          totalSantri,
          totalSantriFormal,
          totalNonMuadalah: nonMuadalahCount,
          totalKelas,
          chartGrupDaimi: chartGrupDaimi as any,
          chartStatistikTingkat: chartStatistikTambahan as any,
          ketersediaanGuru: ketersediaanGuru as any,
          kelengkapanSantri: extraData as any
        },
        create: {
          scopeKey,
          totalSantri,
          totalSantriFormal,
          totalNonMuadalah: nonMuadalahCount,
          totalKelas,
          chartGrupDaimi: chartGrupDaimi as any,
          chartStatistikTingkat: chartStatistikTambahan as any,
          ketersediaanGuru: ketersediaanGuru as any,
          kelengkapanSantri: extraData as any
        }
      });

      return record;
    } catch (err: any) {
      this.logger.error(`Failed to compute rekap for ${scopeKey}: ${err?.message}`, err?.stack);
      throw err;
    }
  }

  // Lightning fast retrieval from rekap_dashboard_utama with dynamic RBAC & activities merge
  async getStatsFromRekap(user: any, query: any = {}) {
    const { wilayahId, cabangId, jenisKelamin, lembagaMuadalahId } = query;

    // Determine target scopeKey
    let targetScope: 'GLOBAL' | 'WILAYAH' | 'CABANG' = 'GLOBAL';
    let targetEntityId: string | undefined = undefined;

    if (cabangId && (user.scope === 'GLOBAL' || user.scope === 'WILAYAH')) {
      targetScope = 'CABANG';
      targetEntityId = cabangId;
    } else if (['CABANG', 'WALI_KELAS', 'GURU'].includes(user.scope)) {
      targetScope = 'CABANG';
      targetEntityId = user.cabangId;
    } else if (wilayahId && user.scope === 'GLOBAL') {
      targetScope = 'WILAYAH';
      targetEntityId = wilayahId;
    } else if (user.scope === 'WILAYAH') {
      targetScope = 'WILAYAH';
      targetEntityId = user.wilayahId;
    }

    // Special query filters (gender, muadalah, teacher scopes) are evaluated dynamically if present
    const hasSpecialFilters = jenisKelamin || lembagaMuadalahId || ['WALI_KELAS', 'GURU'].includes(user.scope);
    if (hasSpecialFilters) {
      return null; // Will trigger fallback to legacy in dashboard.service.ts
    }

    const scopeKey = targetScope === 'GLOBAL' ? 'GLOBAL' : `${targetScope}_${targetEntityId}`;

    let rekap = await this.prisma.rekapDashboardUtama.findUnique({
      where: { scopeKey }
    });

    if (!rekap) {
      this.logger.log(`RekapDashboardUtama miss for ${scopeKey}, computing on-the-fly...`);
      rekap = await this.computeAndSaveForScope(scopeKey, targetScope, targetEntityId);
    }

    // 1. Audit logs (take 10 recent activities)
    const activityWhere: any = {};
    if (targetScope === 'CABANG' && targetEntityId) activityWhere.cabangId = targetEntityId;
    else if (targetScope === 'WILAYAH' && targetEntityId) activityWhere.wilayahId = targetEntityId;

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

    // 2. RBAC Identity
    const rbacIdentity: any = {
      operatorName: user.operatorName || user.username,
      scope: user.scope,
      wilayahName: null,
      cabangName: null,
      ketuaCabangName: null,
      ketuaCabangPhone: null,
      ketuaMuadalahName: null,
      ketuaMuadalahPhone: null
    };

    if (user.scope === 'WILAYAH' && user.wilayahId) {
      const w = await this.prisma.wilayah.findUnique({ where: { id: user.wilayahId } });
      if (w) {
        rbacIdentity.wilayahName = (w as any).name;
        rbacIdentity.ketuaMuadalahName = (w as any).ketuaMuadalahName || null;
        rbacIdentity.ketuaMuadalahPhone = (w as any).ketuaMuadalahPhone || null;
      }
    } else if (['CABANG', 'WALI_KELAS', 'GURU'].includes(user.scope) && user.cabangId) {
      const c = await this.prisma.cabang.findUnique({
        where: { id: user.cabangId },
        include: { wilayah: true }
      });
      if (c) {
        rbacIdentity.cabangName = c.name;
        rbacIdentity.wilayahName = c.wilayah?.name;
        if (c.ketuaCabangId) {
          const ketuaC = await this.prisma.staff.findUnique({ where: { id: c.ketuaCabangId } });
          if (ketuaC) {
            rbacIdentity.ketuaCabangName = ketuaC.name;
            rbacIdentity.ketuaCabangPhone = (ketuaC as any).phone || null;
          }
        }
        if (c.ketuaMuadalahId) {
          const ketuaM = await this.prisma.staff.findUnique({ where: { id: c.ketuaMuadalahId } });
          if (ketuaM) {
            rbacIdentity.ketuaMuadalahName = ketuaM.name;
            rbacIdentity.ketuaMuadalahPhone = (ketuaM as any).phone || null;
          }
        }
      }
    }

    const extra: any = rekap.kelengkapanSantri || {};
    const kGuru: any = Array.isArray(rekap.ketersediaanGuru) ? rekap.ketersediaanGuru : [];

    return {
      totalSantri: rekap.totalSantri,
      totalKelas: rekap.totalKelas,
      totalGuru: extra.totalGuru ?? 0,
      rbacIdentity,
      cabangMissingSubjectsCount: extra.cabangMissingSubjectsCount ?? kGuru.filter((k: any) => k.status !== 'hijau').length,
      ketersediaanGuru: kGuru,
      chartGrupDaimi: rekap.chartGrupDaimi,
      chartKelas: rekap.chartStatistikTingkat,
      activities,
      raporCetakProgress: extra.raporCetakProgress ?? null,
      kelengkapanSiswa: extra.kelengkapanSiswa ?? { total: rekap.totalSantri, lengkap: 0, percent: 0 },
      kelengkapanGuru: extra.kelengkapanGuru ?? { total: extra.totalGuru ?? 0, lengkap: 0, percent: 0 },
      kelengkapanEntities: extra.kelengkapanEntities ?? []
    };
  }
}
