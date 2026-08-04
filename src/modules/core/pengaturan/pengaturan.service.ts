import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import * as fs from 'fs';
import * as path from 'path';

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
        return JSON.parse(raw);
      } catch (e) {
        // Fallback default
      }
    }
    return {
      portalWalsanEnabled: true,
      raporMuadalahEnabled: true,
    };
  }

  async updateModuleSettings(data: { portalWalsanEnabled?: boolean; raporMuadalahEnabled?: boolean }) {
    const current = await this.getModuleSettings();
    const updated = {
      ...current,
      ...(data.portalWalsanEnabled !== undefined && { portalWalsanEnabled: data.portalWalsanEnabled }),
      ...(data.raporMuadalahEnabled !== undefined && { raporMuadalahEnabled: data.raporMuadalahEnabled }),
    };

    const filePath = this.getModuleSettingsFilePath();
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8');
    return updated;
  }
}
