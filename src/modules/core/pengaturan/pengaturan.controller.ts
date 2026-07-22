import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, UseInterceptors, UploadedFile, Res, Inject, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { PengaturanService } from './pengaturan.service.js';
import { AccessControlGuard } from '../../../common/guards/access-control.guard.js';

@Controller('pengaturan')
export class PengaturanController {
  constructor(@Inject(PengaturanService) private readonly pengaturanService: PengaturanService) {}

  // --- AKADEMIK ---
  @Get('akademik')
  @UseGuards(AccessControlGuard)
  getPengaturanAkademik() {
    return this.pengaturanService.getPengaturanAkademik();
  }

  @Put('akademik')
  @UseGuards(AccessControlGuard)
  updatePengaturanAkademik(@Body() data: { semesterAktif: string, tahunAjaran: string, kodeDaftarUlang?: string }) {
    return this.pengaturanService.updatePengaturanAkademik(data);
  }

  // --- PENGUMUMAN ---
  @Get('pengumuman')
  @UseGuards(AccessControlGuard)
  getPengumuman() {
    return this.pengaturanService.getPengumuman();
  }

  @Post('pengumuman')
  @UseGuards(AccessControlGuard)
  createPengumuman(@Body() data: { title: string, content: string, links?: any[], isActive?: boolean, showPopup?: boolean }) {
    return this.pengaturanService.createPengumuman(data);
  }

  @Put('pengumuman/:id')
  @UseGuards(AccessControlGuard)
  updatePengumuman(@Param('id') id: string, @Body() data: { title?: string, content?: string, links?: any[], isActive?: boolean, showPopup?: boolean }) {
    return this.pengaturanService.updatePengumuman(id, data);
  }

  @Delete('pengumuman/:id')
  @UseGuards(AccessControlGuard)
  deletePengumuman(@Param('id') id: string) {
    return this.pengaturanService.deletePengumuman(id);
  }

  // --- KALENDER ---
  @Get('kalender')
  @UseGuards(AccessControlGuard)
  getKalender() {
    return this.pengaturanService.getKalender();
  }

  @Post('kalender')
  @UseGuards(AccessControlGuard)
  @UseInterceptors(FileInterceptor('file'))
  uploadKalender(@UploadedFile() file: any, @Body('title') title: string) {
    if (!file) throw new BadRequestException('File is required');

    // Size check: Max 5MB
    const MAX_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      throw new BadRequestException('File size exceeds the 5MB limit');
    }

    // Extension check
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.pdf'];
    if (!allowedExtensions.includes(ext)) {
      throw new BadRequestException('Only .jpg, .jpeg, .png, and .pdf files are allowed');
    }

    // MIME type check
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Invalid file type');
    }

    return this.pengaturanService.uploadKalender(file, title);
  }

  @Get('uploads/:filename')
  serveFile(@Param('filename') filename: string, @Res() res: Response) {
    const safeFilename = path.basename(filename);
    const uploadDir = path.join(process.cwd(), 'uploads');
    const filePath = path.join(uploadDir, safeFilename);

    if (fs.existsSync(filePath)) {
      const ext = path.extname(safeFilename).toLowerCase();
      if (ext === '.pdf') {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="' + safeFilename + '"');
      } else if (ext === '.png') {
        res.setHeader('Content-Type', 'image/png');
      } else if (ext === '.jpg' || ext === '.jpeg') {
        res.setHeader('Content-Type', 'image/jpeg');
      }
      return res.sendFile(filePath);
    }
    return res.status(404).send('File not found');
  }

  @Delete('kalender/:id')
  @UseGuards(AccessControlGuard)
  deleteKalender(@Param('id') id: string) {
    return this.pengaturanService.deleteKalender(id);
  }
}
