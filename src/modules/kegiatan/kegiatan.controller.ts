import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, UseInterceptors, UploadedFiles, Res, Inject, ForbiddenException } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { KegiatanService } from './kegiatan.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';
import { Response } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';

const uploadDir = path.join(process.cwd(), 'uploads/kegiatan');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

import { Request as ExpressRequest } from 'express';

const storage = multer.diskStorage({
  destination: (req: ExpressRequest, file: any, cb: (error: Error | null, destination: string) => void) => {
    cb(null, uploadDir);
  },
  filename: (req: ExpressRequest, file: any, cb: (error: Error | null, filename: string) => void) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  }
});

@Controller('kegiatan')
export class KegiatanController {
  constructor(@Inject(KegiatanService) private readonly kegiatanService: KegiatanService) {}

  // === ENDPOINT JENIS KEGIATAN ===

  @Get('jenis')
  @UseGuards(AccessControlGuard)
  async getJenisAll() {
    return this.kegiatanService.findJenisAll();
  }

  @Post('jenis')
  @UseGuards(AccessControlGuard)
  async createJenis(@Request() req: any, @Body() body: any) {
    if (req.user.scope !== 'GLOBAL') {
      throw new ForbiddenException('Hanya admin Pusat (GLOBAL) yang bisa mengelola jenis kegiatan.');
    }
    return this.kegiatanService.createJenis(body);
  }

  @Put('jenis/:id')
  @UseGuards(AccessControlGuard)
  async updateJenis(@Param('id') id: string, @Request() req: any, @Body() body: any) {
    if (req.user.scope !== 'GLOBAL') {
      throw new ForbiddenException('Hanya admin Pusat (GLOBAL) yang bisa mengelola jenis kegiatan.');
    }
    return this.kegiatanService.updateJenis(id, body);
  }

  @Delete('jenis/:id')
  @UseGuards(AccessControlGuard)
  async deleteJenis(@Param('id') id: string, @Request() req: any) {
    if (req.user.scope !== 'GLOBAL') {
      throw new ForbiddenException('Hanya admin Pusat (GLOBAL) yang bisa mengelola jenis kegiatan.');
    }
    return this.kegiatanService.removeJenis(id);
  }


  // === ENDPOINT TEMPLATE KEGIATAN (Dengan Multi-Upload File dari Pusat) ===

  @Get('templates')
  @UseGuards(AccessControlGuard)
  async getTemplatesAll() {
    return this.kegiatanService.findTemplateAll();
  }

  @Post('templates')
  @UseGuards(AccessControlGuard)
  @UseInterceptors(FilesInterceptor('files', 10, { storage }))
  async createTemplate(
    @Request() req: any,
    @Body() body: any,
    @UploadedFiles() files: any[]
  ) {
    if (req.user.scope !== 'GLOBAL') {
      throw new ForbiddenException('Hanya admin Pusat (GLOBAL) yang bisa mengelola template kegiatan.');
    }
    return this.kegiatanService.createTemplate(body, files);
  }

  @Put('templates/:id')
  @UseGuards(AccessControlGuard)
  @UseInterceptors(FilesInterceptor('files', 10, { storage }))
  async updateTemplate(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: any,
    @UploadedFiles() files: any[]
  ) {
    if (req.user.scope !== 'GLOBAL') {
      throw new ForbiddenException('Hanya admin Pusat (GLOBAL) yang bisa mengelola template kegiatan.');
    }
    return this.kegiatanService.updateTemplate(id, body, files);
  }

  @Delete('templates/:id')
  @UseGuards(AccessControlGuard)
  async deleteTemplate(@Param('id') id: string, @Request() req: any) {
    if (req.user.scope !== 'GLOBAL') {
      throw new ForbiddenException('Hanya admin Pusat (GLOBAL) yang bisa mengelola template kegiatan.');
    }
    return this.kegiatanService.removeTemplate(id);
  }

  @Delete('templates/dokumen/:id')
  @UseGuards(AccessControlGuard)
  async deleteTemplateDokumen(@Param('id') id: string, @Request() req: any) {
    if (req.user.scope !== 'GLOBAL') {
      throw new ForbiddenException('Hanya admin Pusat (GLOBAL) yang bisa mengelola template kegiatan.');
    }
    return this.kegiatanService.removeTemplateDokumen(id);
  }


  // === ENDPOINT BAP KEGIATAN CABANG (Dengan Multi-Upload File dari Cabang) ===

  @Post()
  @UseGuards(AccessControlGuard)
  @UseInterceptors(FilesInterceptor('files', 10, { storage }))
  async create(
    @Request() req: any,
    @Body() body: any,
    @UploadedFiles() files: any[]
  ) {
    return this.kegiatanService.create(body, files, req.user);
  }

  @Get()
  @UseGuards(AccessControlGuard)
  async findAll(@Request() req: any) {
    return this.kegiatanService.findAll(req.user);
  }

  @Post(':id/confirm')
  @UseGuards(AccessControlGuard)
  async confirmKegiatan(@Param('id') id: string, @Request() req: any) {
    if (req.user.scope !== 'GLOBAL') {
      throw new ForbiddenException('Only Pusat (GLOBAL) can confirm Kegiatan BAP receipt');
    }
    return this.kegiatanService.confirmKegiatan(id, req.user.id);
  }

  @Get(':id')
  @UseGuards(AccessControlGuard)
  async findOne(@Param('id') id: string, @Request() req: any) {
    return this.kegiatanService.findOne(id, req.user);
  }

  @Put(':id')
  @UseGuards(AccessControlGuard)
  @UseInterceptors(FilesInterceptor('files', 10, { storage }))
  async update(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: any,
    @UploadedFiles() files: any[]
  ) {
    return this.kegiatanService.update(id, body, files, req.user);
  }

  @Delete(':id')
  @UseGuards(AccessControlGuard)
  async remove(@Param('id') id: string, @Request() req: any) {
    return this.kegiatanService.remove(id, req.user);
  }

  @Get('uploads/:filename')
  serveFile(@Param('filename') filename: string, @Res() res: Response) {
    const safeFilename = path.basename(filename);
    const filePath = path.join(uploadDir, safeFilename);

    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }
    return res.status(404).send('File not found');
  }
}
