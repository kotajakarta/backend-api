import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, UseInterceptors, UploadedFiles, Res, Inject } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { KegiatanService } from './kegiatan.service.js';
import { CreateKegiatanDto, UpdateKegiatanDto } from './dto/kegiatan.dto.js';
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

  @Post()
  @UseGuards(AccessControlGuard)
  @UseInterceptors(FilesInterceptor('files', 10, { storage }))
  async create(
    @Body() body: any,
    @UploadedFiles() files: any[]
  ) {
    const createDto = new CreateKegiatanDto();
    createDto.judul = body.judul;
    createDto.deskripsi = body.deskripsi;
    createDto.ringkasan = body.ringkasan;
    createDto.jenis = body.jenis;
    createDto.deadline = body.deadline;
    createDto.ketuaPanitiaId = body.ketuaPanitiaId;
    if (body.asramaIds) {
      createDto.asramaIds = Array.isArray(body.asramaIds) ? body.asramaIds : body.asramaIds.split(',').filter(Boolean);
    }
    
    return this.kegiatanService.create(createDto, files);
  }

  @Get()
  @UseGuards(AccessControlGuard)
  async findAll(@Query('status') status?: any) {
    return this.kegiatanService.findAll(status);
  }

  @Get('notifikasi/asrama')
  @UseGuards(AccessControlGuard)
  async getNotifikasiAsrama(@Query('asramaId') asramaId?: string) {
    return this.kegiatanService.getNotifikasiAsrama(asramaId);
  }

  @Post('notifikasi/:id/confirm')
  @UseGuards(AccessControlGuard)
  async confirmNotifikasi(@Param('id') id: string, @Request() req: any) {
    return this.kegiatanService.confirmNotifikasi(id, req.user.id);
  }

  @Get(':id')
  @UseGuards(AccessControlGuard)
  async findOne(@Param('id') id: string) {
    return this.kegiatanService.findOne(id);
  }

  @Put(':id')
  @UseGuards(AccessControlGuard)
  @UseInterceptors(FilesInterceptor('files', 10, { storage }))
  async update(
    @Param('id') id: string,
    @Body() body: any,
    @UploadedFiles() files: any[]
  ) {
    const updateDto: UpdateKegiatanDto = {};
    if (body.judul) updateDto.judul = body.judul;
    if (body.deskripsi) updateDto.deskripsi = body.deskripsi;
    if (body.ringkasan) updateDto.ringkasan = body.ringkasan;
    if (body.jenis) updateDto.jenis = body.jenis;
    if (body.deadline) updateDto.deadline = body.deadline;
    if (body.status) updateDto.status = body.status;
    if (body.ketuaPanitiaId) updateDto.ketuaPanitiaId = body.ketuaPanitiaId;
    if (body.asramaIds) {
      updateDto.asramaIds = Array.isArray(body.asramaIds) ? body.asramaIds : body.asramaIds.split(',').filter(Boolean);
    }

    return this.kegiatanService.update(id, updateDto, files);
  }

  @Delete(':id')
  @UseGuards(AccessControlGuard)
  async remove(@Param('id') id: string) {
    return this.kegiatanService.remove(id);
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
