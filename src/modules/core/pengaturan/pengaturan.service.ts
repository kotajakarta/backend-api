import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import * as fs from 'fs';
import * as path from 'path';
import bcrypt from 'bcrypt';

@Injectable()
export class PengaturanService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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
    const uploadDir = path.join(process.cwd(), 'uploads');
    
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, file.buffer);

    return this.prisma.kalenderAkademik.create({
      data: {
        title: title || 'Kalender Pendidikan',
        fileUrl: `/pengaturan/uploads/${filename}`
      }
    });
  }

  async deleteKalender(id: string) {
    const kalender = await this.prisma.kalenderAkademik.findUnique({ where: { id } });
    if (kalender) {
      const filePath = path.join(process.cwd(), kalender.fileUrl);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
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
    const filePath = this.getModuleSettingsFilePath();
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const settings = JSON.parse(raw);
        if (settings.cctvPin && !settings.cctvPinHash) {
          // One-time migration: earlier versions stored the PIN as plain text.
          settings.cctvPinHash = await bcrypt.hash(String(settings.cctvPin), 10);
          delete settings.cctvPin;
          fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
        }
        return settings;
      } catch (e) {
        // Fallback default
      }
    }
    return {
      portalWalsanEnabled: true,
      raporMuadalahEnabled: true,
      cctvProtectionEnabled: true,
      cctvPinHash: await bcrypt.hash('123456', 10),
      // Walsan granular menus
      walsanCctvEnabled: true,
      walsanRaporEnabled: true,
      walsanKehadiranEnabled: true,
      walsanIzinEnabled: true,
      walsanPengumumanEnabled: true,
      walsanEditBiodataEnabled: false, // Default: false (harus diaktifkan oleh cabang terkait)
      // Cabang granular access
      cabangCctvEnabled: true,
      cabangIzinEnabled: true,
      cabangWalsanListEnabled: true,
      cabangEditBiodataMap: {}, // Map cabangId -> boolean
    };
  }

  /** Settings shape safe to return from the public, unauthenticated GET /pengaturan/modules endpoint. */
  async getPublicModuleSettings() {
    const { cctvPin, cctvPinHash, ...publicSettings } = await this.getModuleSettings();
    return {
      portalWalsanEnabled: true,
      raporMuadalahEnabled: true,
      cctvProtectionEnabled: true,
      walsanCctvEnabled: true,
      walsanRaporEnabled: true,
      walsanKehadiranEnabled: true,
      walsanIzinEnabled: true,
      walsanPengumumanEnabled: true,
      walsanEditBiodataEnabled: false,
      cabangCctvEnabled: true,
      cabangIzinEnabled: true,
      cabangWalsanListEnabled: true,
      cabangEditBiodataMap: {},
      ...publicSettings,
    };
  }

  async updateModuleSettings(data: {
    portalWalsanEnabled?: boolean;
    raporMuadalahEnabled?: boolean;
    cctvProtectionEnabled?: boolean;
    cctvPin?: string;
    walsanCctvEnabled?: boolean;
    walsanRaporEnabled?: boolean;
    walsanKehadiranEnabled?: boolean;
    walsanIzinEnabled?: boolean;
    walsanPengumumanEnabled?: boolean;
    walsanEditBiodataEnabled?: boolean;
    cabangCctvEnabled?: boolean;
    cabangIzinEnabled?: boolean;
    cabangWalsanListEnabled?: boolean;
    cabangEditBiodataMap?: Record<string, boolean>;
  }) {
    const current = await this.getModuleSettings();
    const updated: any = {
      ...current,
      ...(data.portalWalsanEnabled !== undefined && { portalWalsanEnabled: data.portalWalsanEnabled }),
      ...(data.raporMuadalahEnabled !== undefined && { raporMuadalahEnabled: data.raporMuadalahEnabled }),
      ...(data.cctvProtectionEnabled !== undefined && { cctvProtectionEnabled: data.cctvProtectionEnabled }),
      ...(data.walsanCctvEnabled !== undefined && { walsanCctvEnabled: data.walsanCctvEnabled }),
      ...(data.walsanRaporEnabled !== undefined && { walsanRaporEnabled: data.walsanRaporEnabled }),
      ...(data.walsanKehadiranEnabled !== undefined && { walsanKehadiranEnabled: data.walsanKehadiranEnabled }),
      ...(data.walsanIzinEnabled !== undefined && { walsanIzinEnabled: data.walsanIzinEnabled }),
      ...(data.walsanPengumumanEnabled !== undefined && { walsanPengumumanEnabled: data.walsanPengumumanEnabled }),
      ...(data.walsanEditBiodataEnabled !== undefined && { walsanEditBiodataEnabled: data.walsanEditBiodataEnabled }),
      ...(data.cabangCctvEnabled !== undefined && { cabangCctvEnabled: data.cabangCctvEnabled }),
      ...(data.cabangIzinEnabled !== undefined && { cabangIzinEnabled: data.cabangIzinEnabled }),
      ...(data.cabangWalsanListEnabled !== undefined && { cabangWalsanListEnabled: data.cabangWalsanListEnabled }),
      ...(data.cabangEditBiodataMap !== undefined && { cabangEditBiodataMap: data.cabangEditBiodataMap }),
    };
    if (data.cctvPin !== undefined && data.cctvPin.trim() !== '') {
      updated.cctvPinHash = await bcrypt.hash(data.cctvPin.trim(), 10);
    }
    delete updated.cctvPin; // never persist plaintext, even if it was present on `current` from an old file

    const filePath = this.getModuleSettingsFilePath();
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8');

    const { cctvPinHash, ...publicUpdated } = updated;
    return publicUpdated;
  }

  async updateCabangEditBiodata(cabangId: string, isEnabled: boolean) {
    const current = await this.getModuleSettings();
    const cabangMap = { ...(current.cabangEditBiodataMap || {}) };
    cabangMap[cabangId] = isEnabled;

    return this.updateModuleSettings({ cabangEditBiodataMap: cabangMap });
  }

  async verifyCctvPin(pin: string) {
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
