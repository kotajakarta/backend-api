import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, UseInterceptors, UploadedFiles, Res, Inject, ForbiddenException } from '@nestjs/common';
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
    @Request() req: any,
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
    if (body.asramaId) {
      createDto.asramaId = body.asramaId;
    }
    if (body.cabangId) {
      createDto.cabangId = body.cabangId;
    }
    
    return this.kegiatanService.create(createDto, files, req.user);
  }

  @Get()
  @UseGuards(AccessControlGuard)
  async findAll(@Request() req: any, @Query('status') status?: any) {
    return this.kegiatanService.findAll(req.user, status);
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
    const updateDto: UpdateKegiatanDto = {};
    if (body.judul) updateDto.judul = body.judul;
    if (body.deskripsi) updateDto.deskripsi = body.deskripsi;
    if (body.ringkasan) updateDto.ringkasan = body.ringkasan;
    if (body.jenis) updateDto.jenis = body.jenis;
    if (body.deadline) updateDto.deadline = body.deadline;
    if (body.status) updateDto.status = body.status;
    if (body.ketuaPanitiaId) updateDto.ketuaPanitiaId = body.ketuaPanitiaId;
    if (body.asramaId !== undefined) updateDto.asramaId = body.asramaId;
    if (body.cabangId) updateDto.cabangId = body.cabangId;

    return this.kegiatanService.update(id, updateDto, files, req.user);
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
