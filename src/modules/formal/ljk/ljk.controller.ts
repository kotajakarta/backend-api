import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Inject,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { AccessControlGuard } from '../../../common/guards/access-control.guard.js';
import { AllowCookieAuth } from '../../../common/decorators/access-control.decorator.js';
import { MinioService } from '../../../common/minio/minio.service.js';
import { LjkService } from './ljk.service.js';
import { ScanLjkDto } from './dto/scan-ljk.dto.js';
import { ConfirmLjkDto } from './dto/confirm-ljk.dto.js';
import { UpdateLjkDto } from './dto/update-ljk.dto.js';
import path from 'path';

@Controller('formal/ljk')
@UseGuards(AccessControlGuard)
export class LjkController {
  constructor(
    @Inject(LjkService) private readonly ljkService: LjkService,
    @Inject(MinioService) private readonly minioService: MinioService,
  ) {}

  /**
   * Endpoint upload scan gambar LJK untuk diproses OMR (Preview)
   */
  @Post('scan')
  @UseInterceptors(FileInterceptor('file'))
  async scanLjk(
    @UploadedFile() file: any,
    @Body() dto: ScanLjkDto,
    @Req() req: any,
  ) {
    if (!file) throw new BadRequestException('File gambar LJK wajib diunggah.');

    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
    if (!allowedExtensions.includes(ext)) {
      throw new BadRequestException('Format file harus berupa gambar (.jpg, .jpeg, .png, .webp).');
    }

    return this.ljkService.scanLjkFile(file, dto, req.user);
  }

  /**
   * Endpoint simpan hasil verifikasi / edit formulir LJK ke database
   */
  @Post('confirm')
  async confirmLjk(@Body() dto: ConfirmLjkDto, @Req() req: any) {
    return this.ljkService.confirmLjkResult(dto, req.user);
  }

  /**
   * Endpoint riwayat hasil LJK
   */
  @Get()
  async getLjkResults(
    @Req() req: any,
    @Query('kodeCabang') kodeCabang?: string,
    @Query('mapel') mapel?: string,
    @Query('kelas') kelas?: string,
    @Query('semester') semester?: string,
    @Query('nisn') nisn?: string,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.ljkService.getLjkResults(
      { kodeCabang, mapel, kelas, semester, nisn, search, page, limit },
      req.user,
    );
  }

  /**
   * Endpoint serve file foto scan LJK
   */
  @Get('image/:filename')
  @AllowCookieAuth()
  async serveLjkImage(@Param('filename') filename: string, @Res() res: Response) {
    const safeFilename = path.basename(filename);
    const key = `ljk/${safeFilename}`;

    const stat = await this.minioService.statObject(key);
    if (stat) {
      const stream = await this.minioService.getObjectStream(key);
      const mimeType = this.minioService.getMimeType(safeFilename);
      res.removeHeader('X-Frame-Options');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Content-Type', mimeType);
      return stream.pipe(res);
    }

    throw new BadRequestException('Gambar LJK tidak ditemukan.');
  }

  /**
   * Update hasil koreksi manual
   */
  @Put(':id')
  async updateLjkResult(
    @Param('id') id: string,
    @Body() dto: UpdateLjkDto,
    @Req() req: any,
  ) {
    return this.ljkService.updateLjkResult(id, dto, req.user);
  }

  /**
   * Hapus riwayat koreksi LJK
   */
  @Delete(':id')
  async deleteLjkResult(@Param('id') id: string, @Req() req: any) {
    return this.ljkService.deleteLjkResult(id, req.user);
  }
}
