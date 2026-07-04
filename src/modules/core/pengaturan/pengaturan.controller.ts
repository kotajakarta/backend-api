import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, UseInterceptors, UploadedFile, Res, Inject } from '@nestjs/common';
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
  updatePengaturanAkademik(@Body() data: { semesterAktif: string, tahunAjaran: string }) {
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
  createPengumuman(@Body() data: { title: string, content: string, links?: any[], isActive?: boolean }) {
    return this.pengaturanService.createPengumuman(data);
  }

  @Put('pengumuman/:id')
  @UseGuards(AccessControlGuard)
  updatePengumuman(@Param('id') id: string, @Body() data: { title?: string, content?: string, links?: any[], isActive?: boolean }) {
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
    if (!file) throw new Error('File is required');
    return this.pengaturanService.uploadKalender(file, title);
  }

  @Get('uploads/:filename')
  serveFile(@Param('filename') filename: string, @Res() res: Response) {
    const filePath = path.join(process.cwd(), 'uploads', filename);
    if (fs.existsSync(filePath)) {
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
