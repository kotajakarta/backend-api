import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { DEFAULT_PPDB_CONFIG, PpdbFullConfig } from './default-ppdb-data.js';

@Injectable()
export class PpdbService {
  private readonly logger = new Logger(PpdbService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Get public PPDB data.
   * If not found in database, returns pre-seeded default config.
   */
  async getPublicSettings(): Promise<PpdbFullConfig> {
    try {
      const record = await (this.prisma as any).ppdbSetting.findUnique({
        where: { id: 'default' },
      });

      if (!record || !record.isActive) {
        return DEFAULT_PPDB_CONFIG;
      }

      return {
        tahunAjaran: record.tahunAjaran || DEFAULT_PPDB_CONFIG.tahunAjaran,
        semboyan: record.semboyan || DEFAULT_PPDB_CONFIG.semboyan,
        portalUrl: record.portalUrl || DEFAULT_PPDB_CONFIG.portalUrl,
        websiteResmi: record.websiteResmi || DEFAULT_PPDB_CONFIG.websiteResmi,
        isActive: record.isActive ?? true,
        data: (record.data as any) || DEFAULT_PPDB_CONFIG.data,
      };
    } catch (error: any) {
      this.logger.warn(`Failed to query ppdbSetting table, falling back to default config: ${error?.message || error}`);
      return DEFAULT_PPDB_CONFIG;
    }
  }

  /**
   * Get admin PPDB settings (creates default record in DB if absent).
   */
  async getAdminSettings(): Promise<PpdbFullConfig> {
    try {
      let record = await (this.prisma as any).ppdbSetting.findUnique({
        where: { id: 'default' },
      });

      if (!record) {
        record = await (this.prisma as any).ppdbSetting.create({
          data: {
            id: 'default',
            tahunAjaran: DEFAULT_PPDB_CONFIG.tahunAjaran,
            semboyan: DEFAULT_PPDB_CONFIG.semboyan,
            portalUrl: DEFAULT_PPDB_CONFIG.portalUrl,
            websiteResmi: DEFAULT_PPDB_CONFIG.websiteResmi,
            isActive: DEFAULT_PPDB_CONFIG.isActive,
            data: DEFAULT_PPDB_CONFIG.data as any,
          },
        });
      }

      return {
        tahunAjaran: record.tahunAjaran,
        semboyan: record.semboyan,
        portalUrl: record.portalUrl,
        websiteResmi: record.websiteResmi,
        isActive: record.isActive,
        data: record.data as any,
      };
    } catch (error: any) {
      this.logger.error(`Error in getAdminSettings: ${error?.message || error}`);
      return DEFAULT_PPDB_CONFIG;
    }
  }

  /**
   * Update PPDB settings from Admin Panel.
   */
  async updateSettings(body: Partial<PpdbFullConfig>): Promise<PpdbFullConfig> {
    const updated = await (this.prisma as any).ppdbSetting.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        tahunAjaran: body.tahunAjaran || DEFAULT_PPDB_CONFIG.tahunAjaran,
        semboyan: body.semboyan || DEFAULT_PPDB_CONFIG.semboyan,
        portalUrl: body.portalUrl || DEFAULT_PPDB_CONFIG.portalUrl,
        websiteResmi: body.websiteResmi || DEFAULT_PPDB_CONFIG.websiteResmi,
        isActive: body.isActive !== undefined ? body.isActive : true,
        data: (body.data as any) || (DEFAULT_PPDB_CONFIG.data as any),
      },
      update: {
        tahunAjaran: body.tahunAjaran,
        semboyan: body.semboyan,
        portalUrl: body.portalUrl,
        websiteResmi: body.websiteResmi,
        isActive: body.isActive,
        data: body.data ? (body.data as any) : undefined,
      },
    });

    return {
      tahunAjaran: updated.tahunAjaran,
      semboyan: updated.semboyan,
      portalUrl: updated.portalUrl,
      websiteResmi: updated.websiteResmi,
      isActive: updated.isActive,
      data: updated.data as any,
    };
  }

  /**
   * Reset PPDB config back to PDF default template.
   */
  async resetToDefault(): Promise<PpdbFullConfig> {
    const resetRecord = await (this.prisma as any).ppdbSetting.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        tahunAjaran: DEFAULT_PPDB_CONFIG.tahunAjaran,
        semboyan: DEFAULT_PPDB_CONFIG.semboyan,
        portalUrl: DEFAULT_PPDB_CONFIG.portalUrl,
        websiteResmi: DEFAULT_PPDB_CONFIG.websiteResmi,
        isActive: DEFAULT_PPDB_CONFIG.isActive,
        data: DEFAULT_PPDB_CONFIG.data as any,
      },
      update: {
        tahunAjaran: DEFAULT_PPDB_CONFIG.tahunAjaran,
        semboyan: DEFAULT_PPDB_CONFIG.semboyan,
        portalUrl: DEFAULT_PPDB_CONFIG.portalUrl,
        websiteResmi: DEFAULT_PPDB_CONFIG.websiteResmi,
        isActive: DEFAULT_PPDB_CONFIG.isActive,
        data: DEFAULT_PPDB_CONFIG.data as any,
      },
    });

    return {
      tahunAjaran: resetRecord.tahunAjaran,
      semboyan: resetRecord.semboyan,
      portalUrl: resetRecord.portalUrl,
      websiteResmi: resetRecord.websiteResmi,
      isActive: resetRecord.isActive,
      data: resetRecord.data as any,
    };
  }
}
