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
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response, Request as ExpressRequest } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { SuratService } from './surat.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';

const uploadDirSurat = path.join(process.cwd(), 'uploads/surat');
const uploadDirTemplates = path.join(process.cwd(), 'uploads/surat-templates');

if (!fs.existsSync(uploadDirSurat)) fs.mkdirSync(uploadDirSurat, { recursive: true });
if (!fs.existsSync(uploadDirTemplates)) fs.mkdirSync(uploadDirTemplates, { recursive: true });

const storageSurat = multer.diskStorage({
  destination: (req: ExpressRequest, file: any, cb: (error: Error | null, destination: string) => void) => {
    cb(null, uploadDirSurat);
  },
  filename: (req: ExpressRequest, file: any, cb: (error: Error | null, filename: string) => void) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `surat-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  },
});

const storageTemplate = multer.diskStorage({
  destination: (req: ExpressRequest, file: any, cb: (error: Error | null, destination: string) => void) => {
    cb(null, uploadDirTemplates);
  },
  filename: (req: ExpressRequest, file: any, cb: (error: Error | null, filename: string) => void) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `tmpl-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  },
});

@Controller('surat')
export class SuratController {
  constructor(@Inject(SuratService) private readonly suratService: SuratService) {}

  private checkAdmin(req: any) {
    if (req.user?.scope !== 'GLOBAL' && req.user?.username !== 'admin') {
      throw new ForbiddenException('Hanya admin (GLOBAL) yang diizinkan melakukan tindakan ini.');
    }
  }

  // === DASHBOARD & STATS ===
  @Get('stats')
  @UseGuards(AccessControlGuard)
  async getStats() {
    return this.suratService.getLetterStats();
  }

  // === MASTER DATA: DEPARTMENTS ===
  @Get('departments')
  @UseGuards(AccessControlGuard)
  async getDepartments() {
    return this.suratService.getDepartments();
  }

  @Post('departments')
  @UseGuards(AccessControlGuard)
  async createDepartment(@Request() req: any, @Body() body: { code: string; name: string }) {
    this.checkAdmin(req);
    return this.suratService.createDepartment(body);
  }

  @Put('departments/:id')
  @UseGuards(AccessControlGuard)
  async updateDepartment(@Request() req: any, @Param('id') id: string, @Body() body: { code?: string; name?: string }) {
    this.checkAdmin(req);
    return this.suratService.updateDepartment(id, body);
  }

  @Delete('departments/:id')
  @UseGuards(AccessControlGuard)
  async deleteDepartment(@Request() req: any, @Param('id') id: string) {
    this.checkAdmin(req);
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
  async createInstitution(@Request() req: any, @Body() body: { code: string; name: string }) {
    this.checkAdmin(req);
    return this.suratService.createInstitution(body);
  }

  @Put('institutions/:id')
  @UseGuards(AccessControlGuard)
  async updateInstitution(@Request() req: any, @Param('id') id: string, @Body() body: { code?: string; name?: string }) {
    this.checkAdmin(req);
    return this.suratService.updateInstitution(id, body);
  }

  @Delete('institutions/:id')
  @UseGuards(AccessControlGuard)
  async deleteInstitution(@Request() req: any, @Param('id') id: string) {
    this.checkAdmin(req);
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
  async createLetterType(@Request() req: any, @Body() body: { code: string; name: string }) {
    this.checkAdmin(req);
    return this.suratService.createLetterType(body);
  }

  @Put('types/:id')
  @UseGuards(AccessControlGuard)
  async updateLetterType(@Request() req: any, @Param('id') id: string, @Body() body: { code?: string; name?: string }) {
    this.checkAdmin(req);
    return this.suratService.updateLetterType(id, body);
  }

  @Delete('types/:id')
  @UseGuards(AccessControlGuard)
  async deleteLetterType(@Request() req: any, @Param('id') id: string) {
    this.checkAdmin(req);
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
  async updateFormatTemplate(@Request() req: any, @Body() body: { template: string }) {
    this.checkAdmin(req);
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
  @UseInterceptors(FileInterceptor('file', { storage: storageTemplate }))
  async createTemplate(@Request() req: any, @Body() body: any, @UploadedFile() file: any) {
    this.checkAdmin(req);
    return this.suratService.createTemplate(body, file, req.user?.id);
  }

  @Delete('templates/:id')
  @UseGuards(AccessControlGuard)
  async deleteTemplate(@Request() req: any, @Param('id') id: string) {
    this.checkAdmin(req);
    return this.suratService.deleteTemplate(id);
  }

  @Get('templates/download/:filename')
  serveTemplateFile(@Param('filename') filename: string, @Res() res: Response) {
    const safeFilename = path.basename(filename);
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
    });
  }

  @Post('letters/generate')
  @UseGuards(AccessControlGuard)
  @UseInterceptors(FileInterceptor('file', { storage: storageSurat }))
  async generateLetter(@Request() req: any, @Body() body: any, @UploadedFile() file: any) {
    return this.suratService.generateLetter(body, file, req.user?.id);
  }

  @Delete('letters/:id')
  @UseGuards(AccessControlGuard)
  async deleteLetter(@Request() req: any, @Param('id') id: string) {
    return this.suratService.deleteLetter(id);
  }

  @Get('letters/download/:filename')
  serveLetterFile(@Param('filename') filename: string, @Res() res: Response) {
    const safeFilename = path.basename(filename);
    const filePath = path.join(uploadDirSurat, safeFilename);
    if (fs.existsSync(filePath)) {
      return res.download(filePath);
    }
    return res.status(404).send('File surat tidak ditemukan.');
  }
}
