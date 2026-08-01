import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import * as fs from 'fs';
import * as path from 'path';

const uploadDirSurat = path.join(process.cwd(), 'uploads/surat');
const uploadDirTemplates = path.join(process.cwd(), 'uploads/surat-templates');

if (!fs.existsSync(uploadDirSurat)) fs.mkdirSync(uploadDirSurat, { recursive: true });
if (!fs.existsSync(uploadDirTemplates)) fs.mkdirSync(uploadDirTemplates, { recursive: true });

function toRoman(num: number): string {
  const map: { [key: number]: string } = {
    12: 'XII', 11: 'XI', 10: 'X', 9: 'IX', 8: 'VIII',
    7: 'VII', 6: 'VI', 5: 'V', 4: 'IV', 3: 'III', 2: 'II', 1: 'I'
  };
  return map[num] || String(num).padStart(2, '0');
}

@Injectable()
export class SuratService {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): any {
    return this.prisma as any;
  }

  // Ensure default master data exists
  async ensureDefaults() {
    // 1. Format Template
    const existingFormat = await this.db.formatTemplate.findFirst();
    if (!existingFormat) {
      await this.db.formatTemplate.create({
        data: {
          id: '1',
          template: '{sequence}/{letter_type}/{department}/{institution}/{month}/{year}',
        },
      });
    }

    // 2. Departments
    const deptCount = await this.db.department.count();
    if (deptCount === 0) {
      await this.db.department.createMany({
        data: [
          { code: 'SEKR', name: 'Sekretariat' },
          { code: 'AKAD', name: 'Akademik & Kurikulum' },
          { code: 'KEU', name: 'Keuangan & Administrasi' },
          { code: 'KES', name: 'Kesiswaan & Pengasuhan' },
          { code: 'HUMAS', name: 'Humas & Kerjasama' },
        ],
      });
    }

    // 3. Institutions
    const instCount = await this.db.institution.count();
    if (instCount === 0) {
      await this.db.institution.createMany({
        data: [
          { code: 'PUSDATIN', name: 'Pusat Data & Informasi' },
          { code: 'PST', name: 'Pondok Pesantren Pusat' },
          { code: 'SMA', name: 'SMA Muadalah' },
          { code: 'SMP', name: 'SMP Muadalah' },
        ],
      });
    }

    // 4. Letter Types
    const typeCount = await this.db.letterType.count();
    if (typeCount === 0) {
      await this.db.letterType.createMany({
        data: [
          { code: 'SK', name: 'Surat Keputusan' },
          { code: 'ST', name: 'Surat Tugas' },
          { code: 'SE', name: 'Surat Edaran' },
          { code: 'SKET', name: 'Surat Keterangan' },
          { code: 'SP', name: 'Surat Permohonan' },
          { code: 'SB', name: 'Surat Balasan' },
        ],
      });
    }
  }

  // === DEPARTMENTS ===
  async getDepartments() {
    await this.ensureDefaults();
    return this.db.department.findMany({ orderBy: { code: 'asc' } });
  }

  async createDepartment(data: { code: string; name: string }) {
    if (!data?.code || !data?.name) {
      throw new BadRequestException('Kode dan Nama Departemen wajib diisi.');
    }
    const codeUpper = data.code.trim().toUpperCase();
    const existing = await this.db.department.findUnique({ where: { code: codeUpper } });
    if (existing) {
      throw new BadRequestException(`Kode departemen '${codeUpper}' sudah digunakan.`);
    }
    return this.db.department.create({
      data: { code: codeUpper, name: data.name.trim() },
    });
  }

  async updateDepartment(id: string, data: { code?: string; name?: string }) {
    const updateData: any = {};
    if (data.name) updateData.name = data.name.trim();
    if (data.code) {
      const codeUpper = data.code.trim().toUpperCase();
      const existing = await this.db.department.findFirst({
        where: { code: codeUpper, NOT: { id } },
      });
      if (existing) {
        throw new BadRequestException(`Kode departemen '${codeUpper}' sudah digunakan.`);
      }
      updateData.code = codeUpper;
    }
    return this.db.department.update({ where: { id }, data: updateData });
  }

  async deleteDepartment(id: string) {
    try {
      return await this.db.department.delete({ where: { id } });
    } catch (e) {
      throw new BadRequestException('Departemen tidak dapat dihapus karena masih digunakan pada data surat.');
    }
  }

  // === INSTITUTIONS ===
  async getInstitutions() {
    await this.ensureDefaults();
    return this.db.institution.findMany({ orderBy: { code: 'asc' } });
  }

  async createInstitution(data: { code: string; name: string }) {
    if (!data?.code || !data?.name) {
      throw new BadRequestException('Kode dan Nama Institusi wajib diisi.');
    }
    const codeUpper = data.code.trim().toUpperCase();
    const existing = await this.db.institution.findUnique({ where: { code: codeUpper } });
    if (existing) {
      throw new BadRequestException(`Kode institusi '${codeUpper}' sudah digunakan.`);
    }
    return this.db.institution.create({
      data: { code: codeUpper, name: data.name.trim() },
    });
  }

  async updateInstitution(id: string, data: { code?: string; name?: string }) {
    const updateData: any = {};
    if (data.name) updateData.name = data.name.trim();
    if (data.code) {
      const codeUpper = data.code.trim().toUpperCase();
      const existing = await this.db.institution.findFirst({
        where: { code: codeUpper, NOT: { id } },
      });
      if (existing) {
        throw new BadRequestException(`Kode institusi '${codeUpper}' sudah digunakan.`);
      }
      updateData.code = codeUpper;
    }
    return this.db.institution.update({ where: { id }, data: updateData });
  }

  async deleteInstitution(id: string) {
    try {
      return await this.db.institution.delete({ where: { id } });
    } catch (e) {
      throw new BadRequestException('Institusi tidak dapat dihapus karena masih digunakan pada data surat.');
    }
  }

  // === LETTER TYPES ===
  async getLetterTypes() {
    await this.ensureDefaults();
    return this.db.letterType.findMany({ orderBy: { code: 'asc' } });
  }

  async createLetterType(data: { code: string; name: string }) {
    if (!data?.code || !data?.name) {
      throw new BadRequestException('Kode dan Nama Jenis Surat wajib diisi.');
    }
    const codeUpper = data.code.trim().toUpperCase();
    const existing = await this.db.letterType.findUnique({ where: { code: codeUpper } });
    if (existing) {
      throw new BadRequestException(`Kode jenis surat '${codeUpper}' sudah digunakan.`);
    }
    return this.db.letterType.create({
      data: { code: codeUpper, name: data.name.trim() },
    });
  }

  async updateLetterType(id: string, data: { code?: string; name?: string }) {
    const updateData: any = {};
    if (data.name) updateData.name = data.name.trim();
    if (data.code) {
      const codeUpper = data.code.trim().toUpperCase();
      const existing = await this.db.letterType.findFirst({
        where: { code: codeUpper, NOT: { id } },
      });
      if (existing) {
        throw new BadRequestException(`Kode jenis surat '${codeUpper}' sudah digunakan.`);
      }
      updateData.code = codeUpper;
    }
    return this.db.letterType.update({ where: { id }, data: updateData });
  }

  async deleteLetterType(id: string) {
    try {
      return await this.db.letterType.delete({ where: { id } });
    } catch (e) {
      throw new BadRequestException('Jenis Surat tidak dapat dihapus karena masih digunakan pada data surat.');
    }
  }

  // === FORMAT TEMPLATE ===
  async getFormatTemplate() {
    await this.ensureDefaults();
    const format = await this.db.formatTemplate.findFirst();
    return format || { id: '1', template: '{sequence}/{letter_type}/{department}/{institution}/{month}/{year}' };
  }

  async updateFormatTemplate(template: string) {
    const existing = await this.db.formatTemplate.findFirst();
    if (existing) {
      return this.db.formatTemplate.update({
        where: { id: existing.id },
        data: { template },
      });
    } else {
      return this.db.formatTemplate.create({
        data: { id: '1', template },
      });
    }
  }

  // === TEMPLATES SURAT (DOCX/PDF) ===
  async getTemplates() {
    return this.db.template.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, username: true, operatorName: true },
        },
      },
    });
  }

  async createTemplate(body: { title: string; description?: string }, file?: any, userId?: string) {
    if (!file) {
      throw new BadRequestException('File template wajib diunggah.');
    }
    return this.db.template.create({
      data: {
        title: body.title,
        description: body.description || '',
        fileName: file.filename,
        originalName: file.originalname,
        userId: userId || null,
      },
    });
  }

  async deleteTemplate(id: string) {
    const tmpl = await this.db.template.findUnique({ where: { id } });
    if (!tmpl) throw new NotFoundException('Template tidak ditemukan.');

    const filePath = path.join(uploadDirTemplates, tmpl.fileName);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) { console.error(e); }
    }

    return this.db.template.delete({ where: { id } });
  }

  // === LETTERS MANAGEMENT & GENERATION ===
  async getLetterStats() {
    await this.ensureDefaults();
    const now = new Date();
    const currentMonth = String(now.getMonth() + 1);
    const currentYear = String(now.getFullYear());

    const [totalLetters, monthLetters, totalTemplates, totalTypes] = await Promise.all([
      this.db.letter.count(),
      this.db.letter.count({
        where: { month: currentMonth, year: currentYear },
      }),
      this.db.template.count(),
      this.db.letterType.count(),
    ]);

    return {
      totalLetters,
      monthLetters,
      totalTemplates,
      totalTypes,
    };
  }

  async getLetters(filters: {
    search?: string;
    letterTypeId?: string;
    departmentId?: string;
    institutionId?: string;
    month?: string;
    year?: string;
  }) {
    await this.ensureDefaults();
    const where: any = {};

    if (filters.letterTypeId) where.letterTypeId = filters.letterTypeId;
    if (filters.departmentId) where.departmentId = filters.departmentId;
    if (filters.institutionId) where.institutionId = filters.institutionId;
    if (filters.month) where.month = filters.month;
    if (filters.year) where.year = filters.year;

    if (filters.search) {
      where.OR = [
        { generatedNumber: { contains: filters.search, mode: 'insensitive' } },
        { subject: { contains: filters.search, mode: 'insensitive' } },
        { addressedTo: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    return this.db.letter.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        letterType: true,
        department: true,
        institution: true,
        user: {
          select: { id: true, username: true, operatorName: true },
        },
      },
    });
  }

  async generateLetter(
    body: {
      letterTypeId: string;
      departmentId: string;
      institutionId: string;
      subject: string;
      addressedTo: string;
      letterDate?: string;
    },
    file?: any,
    userId?: string,
  ) {
    await this.ensureDefaults();

    const [letterType, department, institution, formatObj] = await Promise.all([
      this.db.letterType.findUnique({ where: { id: body.letterTypeId } }),
      this.db.department.findUnique({ where: { id: body.departmentId } }),
      this.db.institution.findUnique({ where: { id: body.institutionId } }),
      this.getFormatTemplate(),
    ]);

    if (!letterType || !department || !institution) {
      throw new BadRequestException('Jenis Surat, Departemen, atau Institusi tidak valid.');
    }

    const letterDate = body.letterDate || new Date().toISOString().split('T')[0];
    const dateObj = new Date(letterDate);
    const mNum = dateObj.getMonth() + 1;
    const monthStr = String(mNum);
    const monthRoman = toRoman(mNum);
    const yearStr = String(dateObj.getFullYear());

    // Calculate sequence number for this year
    const lastLetter = await this.db.letter.findFirst({
      where: { year: yearStr },
      orderBy: { sequenceNumber: 'desc' },
    });

    const sequenceNumber = (lastLetter?.sequenceNumber || 0) + 1;
    const seqPadded = String(sequenceNumber).padStart(3, '0');

    // Replace placeholders in format template
    let generatedNumber = formatObj.template
      .replace(/\{sequence\}/g, seqPadded)
      .replace(/\{seq\}/g, seqPadded)
      .replace(/\{letter_type\}/g, letterType.code)
      .replace(/\{type\}/g, letterType.code)
      .replace(/\{department\}/g, department.code)
      .replace(/\{dept\}/g, department.code)
      .replace(/\{institution\}/g, institution.code)
      .replace(/\{inst\}/g, institution.code)
      .replace(/\{month\}/g, monthRoman)
      .replace(/\{month_num\}/g, monthStr.padStart(2, '0'))
      .replace(/\{year\}/g, yearStr);

    const uniqueId = `SURAT-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    const letter = await this.db.letter.create({
      data: {
        uniqueId,
        sequenceNumber,
        letterTypeId: body.letterTypeId,
        departmentId: body.departmentId,
        institutionId: body.institutionId,
        month: monthStr,
        year: yearStr,
        generatedNumber,
        userId: userId || '',
        letterDate,
        subject: body.subject,
        addressedTo: body.addressedTo,
        fileUrl: file ? file.filename : null,
      },
      include: {
        letterType: true,
        department: true,
        institution: true,
        user: {
          select: { id: true, username: true, operatorName: true },
        },
      },
    });

    return letter;
  }

  async deleteLetter(id: string) {
    const letter = await this.db.letter.findUnique({ where: { id } });
    if (!letter) throw new NotFoundException('Surat tidak ditemukan.');

    if (letter.fileUrl) {
      const filePath = path.join(uploadDirSurat, letter.fileUrl);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) { console.error(e); }
      }
    }

    return this.db.letter.delete({ where: { id } });
  }
}
