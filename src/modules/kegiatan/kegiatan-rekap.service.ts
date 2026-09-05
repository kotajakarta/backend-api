import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service.js';

@Injectable()
export class KegiatanRekapService {
  private readonly logger = new Logger(KegiatanRekapService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // Sync aggregation for a specific templateId or 'ALL'
  async syncKegiatanRekap(targetTemplateId?: string) {
    const templatesList = await this.prisma.templateKegiatan.findMany({
      select: {
        id: true,
        judul: true,
        tanggalKegiatan: true,
        deadline: true,
        jenis: { select: { nama: true } }
      },
      orderBy: { deadline: 'desc' }
    });

    const templateIdsToSync = targetTemplateId ? [targetTemplateId] : ['ALL', ...templatesList.map(t => t.id)];

    for (const tmplId of templateIdsToSync) {
      await this.computeAndSaveForTemplate(tmplId === 'ALL' ? undefined : tmplId, templatesList);
    }

    this.logger.log(`RekapKegiatan synced for ${templateIdsToSync.length} template targets.`);
    return { syncedCount: templateIdsToSync.length };
  }

  private async computeAndSaveForTemplate(templateId: string | undefined, templatesList: any[]) {
    const isAggregate = !templateId;
    const templateIdKey = templateId || 'ALL';
    const totalTemplates = isAggregate ? templatesList.length : 1;

    const whereKegiatan: any = {};
    if (templateId) whereKegiatan.templateId = templateId;

    const allCabang = await this.prisma.cabang.findMany({
      include: {
        wilayah: { select: { id: true, name: true } },
        kegiatan: {
          where: whereKegiatan,
          select: {
            id: true,
            isConfirmed: true,
            totalSantri: true,
            totalGuru: true,
            jumlahPeserta: true,
            templateId: true
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    const allWilayah = await this.prisma.wilayah.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' }
    });

    const allLembaga = await this.prisma.lembagaMuadalah.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true, jenjang: true },
      orderBy: { name: 'asc' }
    });

    const activeKelasLembaga = await this.prisma.kelas.findMany({
      where: {
        isActive: true,
        lembagaMuadalahId: { not: null },
        cabangId: { not: null }
      },
      select: {
        cabangId: true,
        lembagaMuadalahId: true
      }
    });

    const cabangToLembagaMap = new Map<string, Set<string>>();
    const lembagaToCabangMap = new Map<string, Set<string>>();

    activeKelasLembaga.forEach(k => {
      if (k.cabangId && k.lembagaMuadalahId) {
        if (!cabangToLembagaMap.has(k.cabangId)) cabangToLembagaMap.set(k.cabangId, new Set());
        cabangToLembagaMap.get(k.cabangId)!.add(k.lembagaMuadalahId);

        if (!lembagaToCabangMap.has(k.lembagaMuadalahId)) lembagaToCabangMap.set(k.lembagaMuadalahId, new Set());
        lembagaToCabangMap.get(k.lembagaMuadalahId)!.add(k.cabangId);
      }
    });

    // 1. Cabang rollups
    const cabangUpserts = allCabang.map(c => {
      const submitted = c.kegiatan.length;
      const confirmed = c.kegiatan.filter(k => k.isConfirmed).length;
      const pending = Math.max(0, submitted - confirmed);

      let santri = 0;
      let guru = 0;
      let peserta = 0;

      c.kegiatan.forEach(k => {
        const s = k.totalSantri || 0;
        const g = k.totalGuru || 0;
        santri += s;
        guru += g;
        peserta += k.jumlahPeserta || (s + g);
      });

      const rate = totalTemplates > 0 ? Math.min(100, Math.round((submitted / totalTemplates) * 100)) : 0;
      let status = 'BELUM_ADA';
      if (rate >= 100) status = 'SELESAI';
      else if (submitted > 0) status = 'SEBAGIAN';

      const lembagaIds = cabangToLembagaMap.get(c.id) || new Set<string>();
      const lembagaList = allLembaga.filter(l => lembagaIds.has(l.id));

      return this.prisma.rekapKegiatan.upsert({
        where: {
          templateId_groupType_groupId: {
            templateId: templateIdKey,
            groupType: 'CABANG',
            groupId: c.id
          }
        },
        update: {
          groupName: c.name,
          parentGroupId: c.wilayahId || null,
          totalCabang: 1,
          activeCabangCount: submitted > 0 ? 1 : 0,
          totalBapSubmitted: submitted,
          totalBapConfirmed: confirmed,
          totalBapPending: pending,
          totalSantri: santri,
          totalGuru: guru,
          totalPeserta: peserta,
          completionRate: rate,
          status,
          extraData: { lembagaList, wilayahName: c.wilayah?.name || 'Tanpa Wilayah' } as any
        },
        create: {
          templateId: templateIdKey,
          groupType: 'CABANG',
          groupId: c.id,
          groupName: c.name,
          parentGroupId: c.wilayahId || null,
          totalCabang: 1,
          activeCabangCount: submitted > 0 ? 1 : 0,
          totalBapSubmitted: submitted,
          totalBapConfirmed: confirmed,
          totalBapPending: pending,
          totalSantri: santri,
          totalGuru: guru,
          totalPeserta: peserta,
          completionRate: rate,
          status,
          extraData: { lembagaList, wilayahName: c.wilayah?.name || 'Tanpa Wilayah' } as any
        }
      });
    });

    // 2. Wilayah rollups
    const wilayahUpserts = allWilayah.map(w => {
      const cabangsInWil = allCabang.filter(c => c.wilayahId === w.id);
      const totalCabang = cabangsInWil.length;
      let activeCabangCount = 0;
      let submitted = 0;
      let confirmed = 0;
      let santri = 0;
      let guru = 0;
      let peserta = 0;

      cabangsInWil.forEach(c => {
        const cSubmitted = c.kegiatan.length;
        if (cSubmitted > 0) activeCabangCount++;
        submitted += cSubmitted;
        confirmed += c.kegiatan.filter(k => k.isConfirmed).length;

        c.kegiatan.forEach(k => {
          const s = k.totalSantri || 0;
          const g = k.totalGuru || 0;
          santri += s;
          guru += g;
          peserta += k.jumlahPeserta || (s + g);
        });
      });

      const expected = totalTemplates * Math.max(totalCabang, 1);
      const rate = expected > 0 ? Math.min(100, Math.round((submitted / expected) * 100)) : 0;
      const pending = Math.max(0, submitted - confirmed);

      return this.prisma.rekapKegiatan.upsert({
        where: {
          templateId_groupType_groupId: {
            templateId: templateIdKey,
            groupType: 'WILAYAH',
            groupId: w.id
          }
        },
        update: {
          groupName: w.name,
          parentGroupId: null,
          totalCabang,
          activeCabangCount,
          totalBapSubmitted: submitted,
          totalBapConfirmed: confirmed,
          totalBapPending: pending,
          totalSantri: santri,
          totalGuru: guru,
          totalPeserta: peserta,
          completionRate: rate,
          status: rate >= 100 ? 'SELESAI' : submitted > 0 ? 'SEBAGIAN' : 'BELUM_ADA'
        },
        create: {
          templateId: templateIdKey,
          groupType: 'WILAYAH',
          groupId: w.id,
          groupName: w.name,
          parentGroupId: null,
          totalCabang,
          activeCabangCount,
          totalBapSubmitted: submitted,
          totalBapConfirmed: confirmed,
          totalBapPending: pending,
          totalSantri: santri,
          totalGuru: guru,
          totalPeserta: peserta,
          completionRate: rate,
          status: rate >= 100 ? 'SELESAI' : submitted > 0 ? 'SEBAGIAN' : 'BELUM_ADA'
        }
      });
    });

    // 3. Lembaga Muadalah rollups (Multi-lembaga mapping)
    const lembagaUpserts = allLembaga.map(lem => {
      const affiliatedCabangIds = lembagaToCabangMap.get(lem.id) || new Set<string>();
      const cabangsInLembaga = allCabang.filter(c => affiliatedCabangIds.has(c.id));
      const totalCabang = cabangsInLembaga.length;
      let activeCabangCount = 0;
      let submitted = 0;
      let confirmed = 0;
      let santri = 0;
      let guru = 0;
      let peserta = 0;

      cabangsInLembaga.forEach(c => {
        const cSubmitted = c.kegiatan.length;
        if (cSubmitted > 0) activeCabangCount++;
        submitted += cSubmitted;
        confirmed += c.kegiatan.filter(k => k.isConfirmed).length;

        c.kegiatan.forEach(k => {
          const s = k.totalSantri || 0;
          const g = k.totalGuru || 0;
          santri += s;
          guru += g;
          peserta += k.jumlahPeserta || (s + g);
        });
      });

      const expected = totalTemplates * Math.max(totalCabang, 1);
      const rate = expected > 0 ? Math.min(100, Math.round((submitted / expected) * 100)) : 0;
      const pending = Math.max(0, submitted - confirmed);

      return this.prisma.rekapKegiatan.upsert({
        where: {
          templateId_groupType_groupId: {
            templateId: templateIdKey,
            groupType: 'LEMBAGA',
            groupId: lem.id
          }
        },
        update: {
          groupName: lem.name,
          parentGroupId: null,
          totalCabang,
          activeCabangCount,
          totalBapSubmitted: submitted,
          totalBapConfirmed: confirmed,
          totalBapPending: pending,
          totalSantri: santri,
          totalGuru: guru,
          totalPeserta: peserta,
          completionRate: rate,
          status: rate >= 100 ? 'SELESAI' : submitted > 0 ? 'SEBAGIAN' : 'BELUM_ADA',
          extraData: { code: lem.code, jenjang: lem.jenjang } as any
        },
        create: {
          templateId: templateIdKey,
          groupType: 'LEMBAGA',
          groupId: lem.id,
          groupName: lem.name,
          parentGroupId: null,
          totalCabang,
          activeCabangCount,
          totalBapSubmitted: submitted,
          totalBapConfirmed: confirmed,
          totalBapPending: pending,
          totalSantri: santri,
          totalGuru: guru,
          totalPeserta: peserta,
          completionRate: rate,
          status: rate >= 100 ? 'SELESAI' : submitted > 0 ? 'SEBAGIAN' : 'BELUM_ADA',
          extraData: { code: lem.code, jenjang: lem.jenjang } as any
        }
      });
    });

    // 4. Global rollup
    const totalCabang = allCabang.length;
    let totalBapSubmitted = 0;
    let totalBapConfirmed = 0;
    let totalSantriTerjangkau = 0;
    let totalGuruTerjangkau = 0;
    let totalPesertaTerjangkau = 0;
    let activeCabangCount = 0;

    allCabang.forEach(c => {
      if (c.kegiatan.length > 0) activeCabangCount++;
      totalBapSubmitted += c.kegiatan.length;
      totalBapConfirmed += c.kegiatan.filter(k => k.isConfirmed).length;

      c.kegiatan.forEach(k => {
        const s = k.totalSantri || 0;
        const g = k.totalGuru || 0;
        totalSantriTerjangkau += s;
        totalGuruTerjangkau += g;
        totalPesertaTerjangkau += k.jumlahPeserta || (s + g);
      });
    });

    const expectedTotal = totalTemplates * Math.max(totalCabang, 1);
    const completionRate = expectedTotal > 0 ? Math.min(100, Math.round((totalBapSubmitted / expectedTotal) * 100)) : 0;
    const totalBapPending = Math.max(0, totalBapSubmitted - totalBapConfirmed);

    // Categories (byJenis)
    const jenisList = await this.prisma.jenisKegiatan.findMany({
      include: {
        templates: {
          include: {
            kegiatan: {
              where: whereKegiatan
            }
          }
        }
      }
    });

    const byJenis = jenisList.map(j => {
      let bapCount = 0;
      let confirmedCount = 0;
      j.templates.forEach(t => {
        bapCount += t.kegiatan.length;
        confirmedCount += t.kegiatan.filter(k => k.isConfirmed).length;
      });

      return {
        id: j.id,
        jenisName: j.nama,
        templateCount: j.templates.length,
        bapCount,
        confirmedCount
      };
    });

    // Top 10 Cabang
    const topCabang = allCabang.map(c => {
      let totBap = c.kegiatan.length;
      let totPeserta = 0;
      c.kegiatan.forEach(k => {
        totPeserta += k.jumlahPeserta || ((k.totalSantri || 0) + (k.totalGuru || 0));
      });
      return {
        cabangName: c.name,
        totalBap: totBap,
        totalPeserta: totPeserta
      };
    }).sort((a, b) => b.totalBap - a.totalBap).slice(0, 10);

    const globalUpsert = this.prisma.rekapKegiatan.upsert({
      where: {
        templateId_groupType_groupId: {
          templateId: templateIdKey,
          groupType: 'GLOBAL',
          groupId: 'GLOBAL'
        }
      },
      update: {
        groupName: 'PUSAT NASIONAL',
        parentGroupId: null,
        totalCabang,
        activeCabangCount,
        totalBapSubmitted,
        totalBapConfirmed,
        totalBapPending,
        totalSantri: totalSantriTerjangkau,
        totalGuru: totalGuruTerjangkau,
        totalPeserta: totalPesertaTerjangkau,
        completionRate,
        status: completionRate >= 100 ? 'SELESAI' : totalBapSubmitted > 0 ? 'SEBAGIAN' : 'BELUM_ADA',
        extraData: { byJenis, topCabang, totalTemplates } as any
      },
      create: {
        templateId: templateIdKey,
        groupType: 'GLOBAL',
        groupId: 'GLOBAL',
        groupName: 'PUSAT NASIONAL',
        parentGroupId: null,
        totalCabang,
        activeCabangCount,
        totalBapSubmitted,
        totalBapConfirmed,
        totalBapPending,
        totalSantri: totalSantriTerjangkau,
        totalGuru: totalGuruTerjangkau,
        totalPeserta: totalPesertaTerjangkau,
        completionRate,
        status: completionRate >= 100 ? 'SELESAI' : totalBapSubmitted > 0 ? 'SEBAGIAN' : 'BELUM_ADA',
        extraData: { byJenis, topCabang, totalTemplates } as any
      }
    });

    await Promise.all([
      ...cabangUpserts,
      ...wilayahUpserts,
      ...lembagaUpserts,
      globalUpsert
    ]);
  }

  // Fast read directly from RekapKegiatan (<10ms)
  async getDashboardStatsFromRekap(user: any, templateId?: string) {
    const templateKey = templateId || 'ALL';

    let rekapRecords = await this.prisma.rekapKegiatan.findMany({
      where: { templateId: templateKey }
    });

    if (rekapRecords.length === 0) {
      await this.syncKegiatanRekap(templateId);
      rekapRecords = await this.prisma.rekapKegiatan.findMany({
        where: { templateId: templateKey }
      });
    }

    const templatesOptions = await this.prisma.templateKegiatan.findMany({
      select: {
        id: true,
        judul: true,
        tanggalKegiatan: true,
        deadline: true,
        jenis: { select: { nama: true } }
      },
      orderBy: { deadline: 'desc' }
    });

    // Global summary
    const globalRec = rekapRecords.find(r => r.groupType === 'GLOBAL' && r.groupId === 'GLOBAL');
    const globalExtra = (globalRec?.extraData as any) || {};

    const summary = {
      totalTemplates: globalExtra.totalTemplates || (templateId ? 1 : templatesOptions.length),
      totalCabang: globalRec?.totalCabang || 0,
      totalBapSubmitted: globalRec?.totalBapSubmitted || 0,
      totalBapConfirmed: globalRec?.totalBapConfirmed || 0,
      totalBapPending: globalRec?.totalBapPending || 0,
      totalSantriTerjangkau: globalRec?.totalSantri || 0,
      totalGuruTerjangkau: globalRec?.totalGuru || 0,
      totalPesertaTerjangkau: globalRec?.totalPeserta || 0,
      completionRate: globalRec?.completionRate || 0
    };

    // Scoping for Wilayah or Cabang user
    let wilayahRecords = rekapRecords.filter(r => r.groupType === 'WILAYAH');
    let lembagaRecords = rekapRecords.filter(r => r.groupType === 'LEMBAGA');
    let cabangRecords = rekapRecords.filter(r => r.groupType === 'CABANG');

    if (user?.scope === 'WILAYAH' && user.wilayahId) {
      wilayahRecords = wilayahRecords.filter(r => r.groupId === user.wilayahId);
      cabangRecords = cabangRecords.filter(r => r.parentGroupId === user.wilayahId);
    } else if (user?.scope === 'CABANG' && user.cabangId) {
      cabangRecords = cabangRecords.filter(r => r.groupId === user.cabangId);
    }

    const byWilayah = wilayahRecords.map(w => ({
      wilayahId: w.groupId,
      wilayahName: w.groupName,
      totalCabang: w.totalCabang,
      activeCabangCount: w.activeCabangCount,
      totalBapSubmitted: w.totalBapSubmitted,
      totalBapConfirmed: w.totalBapConfirmed,
      totalSantri: w.totalSantri,
      totalGuru: w.totalGuru,
      totalPeserta: w.totalPeserta,
      completionRate: w.completionRate
    }));

    const byLembaga = lembagaRecords.map(l => {
      const extra = (l.extraData as any) || {};
      return {
        lembagaId: l.groupId,
        lembagaName: l.groupName,
        code: extra.code || '',
        jenjang: extra.jenjang || null,
        totalCabang: l.totalCabang,
        activeCabangCount: l.activeCabangCount,
        totalBapSubmitted: l.totalBapSubmitted,
        totalBapConfirmed: l.totalBapConfirmed,
        totalSantri: l.totalSantri,
        totalGuru: l.totalGuru,
        totalPeserta: l.totalPeserta,
        completionRate: l.completionRate
      };
    });

    const byCabangProgress = cabangRecords.map(c => {
      const extra = (c.extraData as any) || {};
      return {
        cabangId: c.groupId,
        cabangName: c.groupName,
        wilayahId: c.parentGroupId || '',
        wilayahName: extra.wilayahName || 'Tanpa Wilayah',
        lembagaList: extra.lembagaList || [],
        totalBapSubmitted: c.totalBapSubmitted,
        totalBapConfirmed: c.totalBapConfirmed,
        totalSantri: c.totalSantri,
        totalGuru: c.totalGuru,
        totalPeserta: c.totalPeserta,
        completionRate: c.completionRate,
        status: c.status
      };
    });

    // Template rekap matrix
    const byTemplate = templatesOptions.map(t => {
      return {
        templateId: t.id,
        judul: t.judul,
        jenisNama: t.jenis?.nama || 'Lainnya',
        deadline: t.deadline.toISOString(),
        totalReported: 0,
        totalConfirmed: 0,
        totalSantri: 0,
        totalGuru: 0
      };
    });

    return {
      summary,
      userScope: user?.scope,
      userWilayahName: user?.wilayahName || null,
      userCabangName: user?.cabangName || null,
      templatesOptions,
      charts: {
        byJenis: globalExtra.byJenis || [],
        topCabang: globalExtra.topCabang || [],
        byTemplate,
        byWilayah,
        byLembaga,
        byCabangProgress,
        byStatus: {
          confirmed: summary.totalBapConfirmed,
          pending: summary.totalBapPending,
          expectedMissing: Math.max(0, summary.totalCabang - globalRec?.activeCabangCount! || 0)
        }
      }
    };
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleNightlyCron() {
    this.logger.log('Starting nightly Kegiatan Rekap sync...');
    try {
      await this.syncKegiatanRekap();
      this.logger.log('Nightly Kegiatan Rekap sync completed.');
    } catch (err: any) {
      this.logger.error('Failed nightly Kegiatan Rekap sync', err?.message || err);
    }
  }
}
