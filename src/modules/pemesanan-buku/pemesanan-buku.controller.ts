import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  PayloadTooLargeException,
  Post,
  Put,
  Query,
  Request,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
  type ExceptionFilter,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response as ExpressResponse } from 'express';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';
import { RequireDivisi, RequireScope } from '../../common/decorators/access-control.decorator.js';
import { PemesananBukuService } from './pemesanan-buku.service.js';
import { PemesananBukuSesiService } from './pemesanan-buku-sesi.service.js';
import { CreateSesiDto, SesiBodyDto, UpdateSesiDto } from './dto/sesi.dto.js';
import { MAX_TTD_BYTES } from './pemesanan-buku-file.js';

export function kirimBerkas(
  res: ExpressResponse,
  buffer: Uint8Array | Buffer,
  mime: string,
  filename: string,
  disposition: 'inline' | 'attachment',
) {
  const aman = filename.replace(/[^A-Za-z0-9._-]+/g, '_');
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('Content-Disposition', `${disposition}; filename="${aman}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.end(Buffer.from(buffer));
}

/** Batas ukuran multer melempar 413 "File too large"; tampilkan pesan yang dimengerti pengguna. */
@Catch(PayloadTooLargeException)
export class UkuranBerkasFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    ctx.getResponse().status(413).json({
      statusCode: 413,
      message: 'Ukuran berkas maksimal 10 MB.',
      timestamp: new Date().toISOString(),
      path: ctx.getRequest().url,
    });
  }
}

@Controller('pemesanan-buku')
@UseGuards(AccessControlGuard)
@RequireDivisi('FORMAL')
export class PemesananBukuController {
  constructor(
    @Inject(PemesananBukuService) private readonly service: PemesananBukuService,
    @Inject(PemesananBukuSesiService) private readonly sesiService: PemesananBukuSesiService,
  ) {}

  // --- SESI ---
  @Get('sesi')
  listSesi() {
    return this.sesiService.listSesi();
  }

  @Post('sesi')
  @RequireScope('GLOBAL')
  createSesi(@Body() dto: CreateSesiDto) {
    return this.sesiService.createSesi(dto);
  }

  @Put('sesi/:id')
  @RequireScope('GLOBAL')
  updateSesi(@Param('id') id: string, @Body() dto: UpdateSesiDto) {
    return this.sesiService.updateSesi(id, dto);
  }

  @Delete('sesi/:id')
  @RequireScope('GLOBAL')
  deleteSesi(@Param('id') id: string) {
    return this.sesiService.deleteSesi(id);
  }

  // --- CABANG ---
  @Get('cabang')
  getCabang(@Request() req: any, @Query('sesiId') sesiId?: string, @Query('cabangId') cabangId?: string) {
    return this.service.getCabang(req.user, sesiId, cabangId);
  }

  @Post('cabang/draft')
  draftCabang(@Request() req: any, @Body() body: SesiBodyDto) {
    return this.service.simpanDraftCabang(req.user, body.sesiId);
  }

  @Post('cabang/submit')
  submitCabang(@Request() req: any, @Body() body: SesiBodyDto) {
    return this.service.submitCabang(req.user, body.sesiId);
  }

  @Get('cabang/pdf')
  async pdfCabang(
    @Request() req: any,
    @Query('sesiId') sesiId: string | undefined,
    @Query('cabangId') cabangId: string | undefined,
    @Res() res: ExpressResponse,
  ) {
    const { buffer, filename } = await this.service.buktiCabangPdf(req.user, sesiId, cabangId);
    kirimBerkas(res, buffer, 'application/pdf', filename, 'attachment');
  }

  // --- WILAYAH ---
  @Get('wilayah')
  getWilayah(@Request() req: any, @Query('sesiId') sesiId?: string, @Query('wilayahId') wilayahId?: string) {
    return this.service.getWilayah(req.user, sesiId, wilayahId);
  }

  @Get('wilayah/berita-acara')
  async beritaAcara(
    @Request() req: any,
    @Query('sesiId') sesiId: string | undefined,
    @Query('wilayahId') wilayahId: string | undefined,
    @Res() res: ExpressResponse,
  ) {
    const { buffer, filename } = await this.service.beritaAcaraPdf(req.user, sesiId, wilayahId);
    kirimBerkas(res, buffer, 'application/pdf', filename, 'inline');
  }

  @Post('wilayah/ttd')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_TTD_BYTES } }))
  @UseFilters(UkuranBerkasFilter)
  uploadTtd(@Request() req: any, @UploadedFile() file: Express.Multer.File | undefined, @Body('sesiId') sesiId: string) {
    return this.service.uploadTtd(req.user, sesiId, file);
  }

  @Get('wilayah/ttd')
  async ttd(
    @Request() req: any,
    @Query('sesiId') sesiId: string | undefined,
    @Query('wilayahId') wilayahId: string | undefined,
    @Res() res: ExpressResponse,
  ) {
    const { buffer, mime, filename } = await this.service.ambilTtd(req.user, sesiId, wilayahId);
    kirimBerkas(res, buffer, mime, filename, 'inline');
  }

  @Post('wilayah/draft')
  draftWilayah(@Request() req: any, @Body() body: SesiBodyDto) {
    return this.service.simpanDraftWilayah(req.user, body.sesiId);
  }

  @Post('wilayah/submit')
  submitWilayah(@Request() req: any, @Body() body: SesiBodyDto) {
    return this.service.submitWilayah(req.user, body.sesiId);
  }

  @Get('wilayah/final')
  async finalWilayah(
    @Request() req: any,
    @Query('sesiId') sesiId: string | undefined,
    @Query('wilayahId') wilayahId: string | undefined,
    @Res() res: ExpressResponse,
  ) {
    const { buffer, filename } = await this.service.finalPdf(req.user, sesiId, wilayahId);
    kirimBerkas(res, buffer, 'application/pdf', filename, 'attachment');
  }

  // --- ADMIN ---
  @Get('rekap')
  @RequireScope('GLOBAL')
  rekap(@Query('sesiId') sesiId?: string) {
    return this.service.getRekap(sesiId);
  }

  @Post('admin/unlock-cabang/:id')
  @RequireScope('GLOBAL')
  unlockCabang(@Param('id') id: string) {
    return this.service.unlockCabang(id);
  }

  @Post('admin/unlock-wilayah/:id')
  @RequireScope('GLOBAL')
  unlockWilayah(@Param('id') id: string) {
    return this.service.unlockWilayah(id);
  }
}
