import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import { MinioService } from '../../../common/minio/minio.service.js';
import { isCctvEnabled } from '../../../common/utils/module-guard.js';
import * as fs from 'fs';
import * as path from 'path';
import bcrypt from 'bcrypt';

@Injectable()
export class PengaturanService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minioService: MinioService
  ) {}

  // --- PENGATURAN AKADEMIK ---

  async getPengaturanAkademik() {
    let setting = await this.prisma.pengaturanAkademik.findFirst();
    if (!setting) {
      setting = await this.prisma.pengaturanAkademik.create({
        data: {
          semesterAktif: 'Ganjil',
          tahunAjaran: '2026/2027',
          kodeDaftarUlang: ''
        }
      });
    }
    return setting;
  }

  async updatePengaturanAkademik(data: { semesterAktif: string, tahunAjaran: string, kodeDaftarUlang?: string }) {
    const setting = await this.getPengaturanAkademik();
    return this.prisma.pengaturanAkademik.update({
      where: { id: setting.id },
      data
    });
  }

  // --- PENGUMUMAN ---

  async getPengumuman() {
    return this.prisma.pengumuman.findMany({
      orderBy: { createdAt: 'desc' }
    });
  }

  async createPengumuman(data: { title: string, content: string, links?: any[], isActive?: boolean, showPopup?: boolean }) {
    return this.prisma.pengumuman.create({
      data: {
        title: data.title,
        content: data.content,
        links: data.links || [],
        isActive: data.isActive ?? true,
        showPopup: data.showPopup ?? false,
      }
    });
  }

  async updatePengumuman(id: string, data: { title?: string, content?: string, links?: any[], isActive?: boolean, showPopup?: boolean }) {
    return this.prisma.pengumuman.update({
      where: { id },
      data
    });
  }

  async deletePengumuman(id: string) {
    return this.prisma.pengumuman.delete({
      where: { id }
    });
  }

  // --- KALENDER PENDIDIKAN ---

  async getKalender() {
    return this.prisma.kalenderAkademik.findMany({
      orderBy: { createdAt: 'desc' }
    });
  }

  async uploadKalender(file: any, title: string) {
    if (!file || !file.buffer) {
      throw new BadRequestException('File is required');
    }

    const ext = path.extname(file.originalname).toLowerCase() || '.pdf';
    const filename = `kalender_${Date.now()}${ext}`;
    const objectKey = `kalender/${filename}`;

    await this.minioService.uploadBuffer(objectKey, file.buffer, file.mimetype);

    return this.prisma.kalenderAkademik.create({
      data: {
        title: title || 'Kalender Pendidikan',
        fileUrl: `/uploads/${objectKey}`
      }
    });
  }

  async deleteKalender(id: string) {
    const kalender = await this.prisma.kalenderAkademik.findUnique({ where: { id } });
    if (kalender) {
      if (kalender.fileUrl) {
        await this.minioService.deleteObject(kalender.fileUrl);
        const filePath = path.join(process.cwd(), kalender.fileUrl.startsWith('/') ? kalender.fileUrl.slice(1) : kalender.fileUrl);
        if (fs.existsSync(filePath)) {
          try { fs.unlinkSync(filePath); } catch {}
        }
      }
      return this.prisma.kalenderAkademik.delete({ where: { id } });
    }
  }


  // --- PENGATURAN MODUL SYSTEM (FEATURE TOGGLES) ---

  private getModuleSettingsFilePath() {
    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    return path.join(uploadDir, 'module-settings.json');
  }

  async getModuleSettings() {
    const isCctvOn = isCctvEnabled();
    const filePath = this.getModuleSettingsFilePath();
    let loadedSettings: any = {};
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        loadedSettings = JSON.parse(raw);
        if (loadedSettings.cctvPin && !loadedSettings.cctvPinHash) {
          // One-time migration: earlier versions stored the PIN as plain text.
          loadedSettings.cctvPinHash = await bcrypt.hash(String(loadedSettings.cctvPin), 10);
          delete loadedSettings.cctvPin;
          fs.writeFileSync(filePath, JSON.stringify(loadedSettings, null, 2), 'utf-8');
        }
      } catch (e) {
        // Fallback default
      }
    }
    const defaultSettings = {
      portalWalsanEnabled: true,
      raporMuadalahEnabled: true,
      bankSoalEnabled: true,
      cctvEnabled: isCctvOn,
      cctvProtectionEnabled: isCctvOn,
      cctvPinHash: await bcrypt.hash('123456', 10),
      // Walsan granular menus
      walsanCctvEnabled: isCctvOn,
      walsanRaporEnabled: true,
      walsanKehadiranEnabled: true,
      walsanIzinEnabled: true,
      walsanPengumumanEnabled: true,
      walsanSyahriyahEnabled: true,
      walsanEditBiodataEnabled: false, // Default: false (harus diaktifkan oleh cabang terkait)
      // Cabang granular access
      cabangCctvEnabled: isCctvOn,
      cabangIzinEnabled: true,
      cabangWalsanListEnabled: true,
      cabangEditBiodataMap: {}, // Map cabangId -> boolean
    };

    const merged = {
      ...defaultSettings,
      ...loadedSettings,
      cctvEnabled: isCctvOn,
      walsanCctvEnabled: isCctvOn ? (loadedSettings.walsanCctvEnabled !== false) : false,
      cabangCctvEnabled: isCctvOn ? (loadedSettings.cabangCctvEnabled !== false) : false,
      cctvProtectionEnabled: isCctvOn ? (loadedSettings.cctvProtectionEnabled !== false) : false,
    };

    return merged;
  }

  /** Settings shape safe to return from the public, unauthenticated GET /pengaturan/modules endpoint. */
  async getPublicModuleSettings() {
    const isCctvOn = isCctvEnabled();
    const { cctvPin, cctvPinHash, ...publicSettings } = await this.getModuleSettings();
    return {
      portalWalsanEnabled: true,
      raporMuadalahEnabled: true,
      bankSoalEnabled: true,
      walsanRaporEnabled: true,
      walsanKehadiranEnabled: true,
      walsanIzinEnabled: true,
      walsanPengumumanEnabled: true,
      walsanSyahriyahEnabled: true,
      walsanEditBiodataEnabled: false,
      cabangIzinEnabled: true,
      cabangWalsanListEnabled: true,
      cabangEditBiodataMap: {},
      ...publicSettings,
      cctvEnabled: isCctvOn,
      walsanCctvEnabled: isCctvOn ? (publicSettings.walsanCctvEnabled !== false) : false,
      cabangCctvEnabled: isCctvOn ? (publicSettings.cabangCctvEnabled !== false) : false,
      cctvProtectionEnabled: isCctvOn ? (publicSettings.cctvProtectionEnabled !== false) : false,
    };
  }

  async updateModuleSettings(data: {
    portalWalsanEnabled?: boolean;
    raporMuadalahEnabled?: boolean;
    bankSoalEnabled?: boolean;
    cctvProtectionEnabled?: boolean;
    cctvPin?: string;
    walsanCctvEnabled?: boolean;
    walsanRaporEnabled?: boolean;
    walsanKehadiranEnabled?: boolean;
    walsanIzinEnabled?: boolean;
    walsanPengumumanEnabled?: boolean;
    walsanSyahriyahEnabled?: boolean;
    walsanEditBiodataEnabled?: boolean;
    cabangCctvEnabled?: boolean;
    cabangIzinEnabled?: boolean;
    cabangWalsanListEnabled?: boolean;
    cabangEditBiodataMap?: Record<string, boolean>;
  }) {
    const isCctvOn = isCctvEnabled();
    const current = await this.getModuleSettings();
    const updated: any = {
      ...current,
      ...(data.portalWalsanEnabled !== undefined && { portalWalsanEnabled: data.portalWalsanEnabled }),
      ...(data.raporMuadalahEnabled !== undefined && { raporMuadalahEnabled: data.raporMuadalahEnabled }),
      ...(data.bankSoalEnabled !== undefined && { bankSoalEnabled: data.bankSoalEnabled }),
      ...(data.cctvProtectionEnabled !== undefined && { cctvProtectionEnabled: isCctvOn ? data.cctvProtectionEnabled : false }),
      ...(data.walsanCctvEnabled !== undefined && { walsanCctvEnabled: isCctvOn ? data.walsanCctvEnabled : false }),
      ...(data.walsanRaporEnabled !== undefined && { walsanRaporEnabled: data.walsanRaporEnabled }),
      ...(data.walsanKehadiranEnabled !== undefined && { walsanKehadiranEnabled: data.walsanKehadiranEnabled }),
      ...(data.walsanIzinEnabled !== undefined && { walsanIzinEnabled: data.walsanIzinEnabled }),
      ...(data.walsanPengumumanEnabled !== undefined && { walsanPengumumanEnabled: data.walsanPengumumanEnabled }),
      ...(data.walsanSyahriyahEnabled !== undefined && { walsanSyahriyahEnabled: data.walsanSyahriyahEnabled }),
      ...(data.walsanEditBiodataEnabled !== undefined && { walsanEditBiodataEnabled: data.walsanEditBiodataEnabled }),
      ...(data.cabangCctvEnabled !== undefined && { cabangCctvEnabled: isCctvOn ? data.cabangCctvEnabled : false }),
      ...(data.cabangIzinEnabled !== undefined && { cabangIzinEnabled: data.cabangIzinEnabled }),
      ...(data.cabangWalsanListEnabled !== undefined && { cabangWalsanListEnabled: data.cabangWalsanListEnabled }),
      ...(data.cabangEditBiodataMap !== undefined && { cabangEditBiodataMap: data.cabangEditBiodataMap }),
    };
    if (isCctvOn && data.cctvPin !== undefined && data.cctvPin.trim() !== '') {
      updated.cctvPinHash = await bcrypt.hash(data.cctvPin.trim(), 10);
    }
    delete updated.cctvPin; // never persist plaintext, even if it was present on `current` from an old file

    const filePath = this.getModuleSettingsFilePath();
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8');

    const { cctvPinHash, ...publicUpdated } = updated;
    return {
      ...publicUpdated,
      cctvEnabled: isCctvOn,
      walsanCctvEnabled: isCctvOn ? (publicUpdated.walsanCctvEnabled !== false) : false,
      cabangCctvEnabled: isCctvOn ? (publicUpdated.cabangCctvEnabled !== false) : false,
      cctvProtectionEnabled: isCctvOn ? (publicUpdated.cctvProtectionEnabled !== false) : false,
    };
  }

  async updateCabangEditBiodata(cabangId: string, isEnabled: boolean) {
    const current = await this.getModuleSettings();
    const cabangMap = { ...(current.cabangEditBiodataMap || {}) };
    cabangMap[cabangId] = isEnabled;

    return this.updateModuleSettings({ cabangEditBiodataMap: cabangMap });
  }

  async verifyCctvPin(pin: string) {
    if (!isCctvEnabled()) {
      throw new BadRequestException('Fitur CCTV saat ini dinonaktifkan di konfigurasi server (.env).');
    }
    if (!pin) {
      throw new BadRequestException('PIN wajib diisi');
    }
    const settings = await this.getModuleSettings();
    const expectedHash = settings.cctvPinHash || (await bcrypt.hash('123456', 10));
    const isValid = await bcrypt.compare(pin.trim(), expectedHash);
    return {
      success: isValid,
      protectionEnabled: settings.cctvProtectionEnabled !== false,
    };
  }
}
