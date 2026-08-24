import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  Res,
  Inject,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response, Request as ExpressRequest } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { SuratService } from './surat.service.js';
import { MinioService } from '../../common/minio/minio.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';
import { RequireScope } from '../../common/decorators/access-control.decorator.js';


const uploadDirSurat = path.join(process.cwd(), 'uploads/surat');
const uploadDirTemplates = path.join(process.cwd(), 'uploads/surat-templates');

if (!fs.existsSync(uploadDirSurat)) fs.mkdirSync(uploadDirSurat, { recursive: true });
if (!fs.existsSync(uploadDirTemplates)) fs.mkdirSync(uploadDirTemplates, { recursive: true });

const storageSurat = multer.diskStorage({
  destination: (req: ExpressRequest, file: any, cb: (error: Error | null, destination: string) => void) => {
    cb(null, uploadDirSurat);
  },
  filename: (req: ExpressRequest, file: any, cb: (error: Error | null, filename: string) => void) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const uniqueName = `surat-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  },
});

const storageTemplate = multer.diskStorage({
  destination: (req: ExpressRequest, file: any, cb: (error: Error | null, destination: string) => void) => {
    cb(null, uploadDirTemplates);
  },
  filename: (req: ExpressRequest, file: any, cb: (error: Error | null, filename: string) => void) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const uniqueName = `tmpl-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  },
});

const ALLOWED_SURAT_MIMES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
];

const fileFilterSurat = (req: ExpressRequest, file: any, cb: any) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const allowedExts = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.webp'];
  if (ALLOWED_SURAT_MIMES.includes(file.mimetype) || allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Format berkas tidak didukung. Hanya PDF, Word (DOC/DOCX), dan Gambar yang diperbolehkan.'), false);
  }
};

const uploadOptionsSurat = {
  storage: storageSurat,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: fileFilterSurat,
};

const uploadOptionsTemplate = {
  storage: storageTemplate,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: fileFilterSurat,
};

@Controller('surat')
export class SuratController {
  constructor(
    @Inject(SuratService) private readonly suratService: SuratService,
    @Inject(MinioService) private readonly minioService: MinioService
  ) {}


  // === DASHBOARD & STATS ===
  @Get('stats')
  @UseGuards(AccessControlGuard)
  async getStats(@Request() req: any) {
    return this.suratService.getLetterStats(req.user);
  }

  // === MASTER DATA: DEPARTMENTS ===
  @Get('departments')
  @UseGuards(AccessControlGuard)
  async getDepartments() {
    return this.suratService.getDepartments();
  }

  @Post('departments')
  @UseGuards(AccessControlGuard)
  @RequireScope('GLOBAL')
  async createDepartment(@Body() body: { code: string; name: string }) {
    return this.suratService.createDepartment(body);
  }

  @Put('departments/:id')
  @UseGuards(AccessControlGuard)
  @RequireScope('GLOBAL')
  async updateDepartment(@Param('id') id: string, @Body() body: { code?: string; name?: string }) {
    return this.suratService.updateDepartment(id, body);
  }

  @Delete('departments/:id')
  @UseGuards(AccessControlGuard)
  @RequireScope('GLOBAL')
  async deleteDepartment(@Param('id') id: string) {
    return this.suratService.deleteDepartment(id);
  }

  // === MASTER DATA: INSTITUTIONS ===
  @Get('institutions')
  @UseGuards(AccessControlGuard)
  async getInstitutions() {
    return this.suratService.getInstitutions();
  }

  @Post('institutions')
  @UseGuards(AccessControlGuard)
  @RequireScope('GLOBAL')
  async createInstitution(@Body() body: { code: string; name: string }) {
    return this.suratService.createInstitution(body);
  }

  @Put('institutions/:id')
  @UseGuards(AccessControlGuard)
  @RequireScope('GLOBAL')
  async updateInstitution(@Param('id') id: string, @Body() body: { code?: string; name?: string }) {
    return this.suratService.updateInstitution(id, body);
  }

  @Delete('institutions/:id')
  @UseGuards(AccessControlGuard)
  @RequireScope('GLOBAL')
  async deleteInstitution(@Param('id') id: string) {
    return this.suratService.deleteInstitution(id);
  }

  // === MASTER DATA: LETTER TYPES ===
  @Get('types')
  @UseGuards(AccessControlGuard)
  async getLetterTypes() {
    return this.suratService.getLetterTypes();
  }

  @Post('types')
  @UseGuards(AccessControlGuard)
  @RequireScope('GLOBAL')
  async createLetterType(@Body() body: { code: string; name: string }) {
    return this.suratService.createLetterType(body);
  }

  @Put('types/:id')
  @UseGuards(AccessControlGuard)
  @RequireScope('GLOBAL')
  async updateLetterType(@Param('id') id: string, @Body() body: { code?: string; name?: string }) {
    return this.suratService.updateLetterType(id, body);
  }

  @Delete('types/:id')
  @UseGuards(AccessControlGuard)
  @RequireScope('GLOBAL')
  async deleteLetterType(@Param('id') id: string) {
    return this.suratService.deleteLetterType(id);
  }

  // === MASTER DATA: FORMAT TEMPLATE ===
  @Get('format-template')
  @UseGuards(AccessControlGuard)
  async getFormatTemplate() {
    return this.suratService.getFormatTemplate();
  }

  @Put('format-template')
  @UseGuards(AccessControlGuard)
  @RequireScope('GLOBAL')
  async updateFormatTemplate(@Body() body: { template: string }) {
    return this.suratService.updateFormatTemplate(body.template);
  }

  // === TEMPLATES SURAT (UPLOAD & DOWNLOAD) ===
  @Get('templates')
  @UseGuards(AccessControlGuard)
  async getTemplates() {
    return this.suratService.getTemplates();
  }

  @Post('templates')
  @UseGuards(AccessControlGuard)
  @RequireScope('GLOBAL')
  @UseInterceptors(FileInterceptor('file', uploadOptionsTemplate))
  async createTemplate(@Request() req: any, @Body() body: any, @UploadedFile() file: any) {
    return this.suratService.createTemplate(body, file, req.user?.id);
  }

  @Delete('templates/:id')
  @UseGuards(AccessControlGuard)
  @RequireScope('GLOBAL')
  async deleteTemplate(@Param('id') id: string) {
    return this.suratService.deleteTemplate(id);
  }

  @Get('templates/download/:filename')
  @UseGuards(AccessControlGuard)
  async serveTemplateFile(@Param('filename') filename: string, @Res() res: Response) {
    const safeFilename = path.basename(filename);

    // Cek di MinIO (surat-templates/${safeFilename} atau ${safeFilename})
    const keysToCheck = [`surat-templates/${safeFilename}`, safeFilename];
    for (const key of keysToCheck) {
      const stat = await this.minioService.statObject(key);
      if (stat) {
        const stream = await this.minioService.getObjectStream(key);
        const mimeType = this.minioService.getMimeType(safeFilename);
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
        return stream.pipe(res);
      }
    }

    const filePath = path.join(uploadDirTemplates, safeFilename);
    if (fs.existsSync(filePath)) {
      return res.download(filePath);
    }
    return res.status(404).send('File template tidak ditemukan.');
  }

  // === LETTERS MANAGEMENT & GENERATION ===
  @Get('letters')
  @UseGuards(AccessControlGuard)
  async getLetters(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('letterTypeId') letterTypeId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('institutionId') institutionId?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.suratService.getLetters({
      search,
      letterTypeId,
      departmentId,
      institutionId,
      month,
      year,
    }, req.user);
  }

  @Post('letters/generate')
  @UseGuards(AccessControlGuard)
  @UseInterceptors(FileInterceptor('file', uploadOptionsSurat))
  async generateLetter(@Request() req: any, @Body() body: any, @UploadedFile() file: any) {
    return this.suratService.generateLetter(body, file, req.user?.id);
  }

  @Delete('letters/:id')
  @UseGuards(AccessControlGuard)
  async deleteLetter(@Request() req: any, @Param('id') id: string) {
    return this.suratService.deleteLetter(id, req.user);
  }

  @Get('letters/download/:filename')
  @UseGuards(AccessControlGuard)
  async serveLetterFile(@Request() req: any, @Param('filename') filename: string, @Res() res: Response) {
    const safeFilename = path.basename(filename);
    const allowed = await this.suratService.checkLetterFileAccess(safeFilename, req.user);
    if (!allowed) {
      return res.status(403).send('Anda tidak memiliki akses ke berkas surat ini.');
    }

    // Cek di MinIO (surat/${safeFilename} atau ${safeFilename})
    const keysToCheck = [`surat/${safeFilename}`, safeFilename];
    for (const key of keysToCheck) {
      const stat = await this.minioService.statObject(key);
      if (stat) {
        const stream = await this.minioService.getObjectStream(key);
        const mimeType = this.minioService.getMimeType(safeFilename);
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
        return stream.pipe(res);
      }
    }

    const filePath = path.join(uploadDirSurat, safeFilename);
    if (fs.existsSync(filePath)) {
      return res.download(filePath);
    }
    return res.status(404).send('File surat tidak ditemukan.');
  }

}
