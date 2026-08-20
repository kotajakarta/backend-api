import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, Request, Inject, BadRequestException } from '@nestjs/common';
import { PembelajaranService } from './pembelajaran.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';
import { RequireDivisi, RequireScope } from '../../common/decorators/access-control.decorator.js';
import { SilabusSummaryQueryDto } from './dto/silabus-summary-query.dto.js';

@Controller('pembelajaran')
@RequireDivisi('FORMAL')
export class PembelajaranController {
  constructor(@Inject(PembelajaranService) private readonly pembelajaranService: PembelajaranService) {}

  // --- Silabus (Admin Pusat) ---

  @Get('silabus')
  @UseGuards(AccessControlGuard)
  @RequireScope('GLOBAL')
  getSilabus(
    @Query('mataPelajaranId') mataPelajaranId: string,
    @Query('tingkat') tingkat: string,
    @Query('tahunAjaran') tahunAjaran: string,
    @Query('semester') semester: string
  ) {
    if (!mataPelajaranId || !tingkat || !tahunAjaran || !semester) {
      throw new BadRequestException('mataPelajaranId, tingkat, tahunAjaran, dan semester wajib diisi');
    }
    return this.pembelajaranService.getSilabus({ mataPelajaranId, tingkat, tahunAjaran, semester });
  }

  @Get('silabus/summary')
  @UseGuards(AccessControlGuard)
  @RequireScope('GLOBAL')
  getSilabusSummary(@Query() query: SilabusSummaryQueryDto) {
    return this.pembelajaranService.getSilabusSummary(query);
  }

  @Get('silabus/export')
  @UseGuards(AccessControlGuard)
  @RequireScope('GLOBAL')
  getAllSilabusForExport() {
    return this.pembelajaranService.getAllSilabusForExport();
  }

  @Post('silabus/bulk')
  @UseGuards(AccessControlGuard)
  @RequireScope('GLOBAL')
  saveSilabusBulk(@Body() data: any) {
    return this.pembelajaranService.saveSilabusBulk(data);
  }

  @Delete('silabus/:id')
  @UseGuards(AccessControlGuard)
  @RequireScope('GLOBAL')
  deleteSilabus(@Param('id') id: string) {
    return this.pembelajaranService.deleteSilabus(id);
  }

  // --- Kontrol Silabus (User Cabang & Batch Tanggal Pelaksanaan) ---

  @Get('pelaksanaan/daily')
  @UseGuards(AccessControlGuard)
  getDailyPelaksanaan(
    @Query('cabangId') cabangId: string,
    @Query('tanggal') tanggal: string,
    @Query('tahunAjaran') tahunAjaran: string,
    @Query('semester') semester: string,
    @Request() req: any
  ) {
    return this.pembelajaranService.getDailyPelaksanaan(req.user, cabangId, tanggal, tahunAjaran, semester);
  }

  @Post('pelaksanaan/daily-bulk')
  @UseGuards(AccessControlGuard)
  saveDailyPelaksanaanBulk(@Body() body: { cabangId?: string; tanggal: string; logs: any[] }, @Request() req: any) {
    return this.pembelajaranService.bulkSaveDailyPelaksanaan(req.user, body);
  }

  @Get('pelaksanaan')
  @UseGuards(AccessControlGuard)
  getPelaksanaan(
    @Query('kelasId') kelasId: string,
    @Query('tahunAjaran') tahunAjaran: string,
    @Query('semester') semester: string
  ) {
    if (!kelasId || !tahunAjaran || !semester) {
      throw new BadRequestException('kelasId, tahunAjaran, dan semester wajib diisi');
    }
    return this.pembelajaranService.getPelaksanaan(kelasId, tahunAjaran, semester);
  }

  @Post('pelaksanaan/bulk')
  @UseGuards(AccessControlGuard)
  savePelaksanaanBulk(@Body() body: { kelasId: string; logs: any[] }, @Request() req: any) {
    return this.pembelajaranService.savePelaksanaanBulk(body.kelasId, body.logs, req.user?.id);
  }

  @Post('pelaksanaan/libur')
  @UseGuards(AccessControlGuard)
  setLibur(@Body() body: { kelasId: string; mataPelajaranId: string; tanggal: string }, @Request() req: any) {
    if (!body.kelasId || !body.mataPelajaranId || !body.tanggal) {
      throw new BadRequestException('kelasId, mataPelajaranId, dan tanggal wajib diisi');
    }
    return this.pembelajaranService.setLiburTanggal(body.kelasId, body.mataPelajaranId, body.tanggal, req.user?.id);
  }

  @Post('pelaksanaan/libur/clear')
  @UseGuards(AccessControlGuard)
  clearLibur(@Body() body: { kelasId: string; mataPelajaranId: string; tanggal: string }) {
    if (!body.kelasId || !body.mataPelajaranId || !body.tanggal) {
      throw new BadRequestException('kelasId, mataPelajaranId, dan tanggal wajib diisi');
    }
    return this.pembelajaranService.clearLiburTanggal(body.kelasId, body.mataPelajaranId, body.tanggal);
  }

  // --- Absensi Mapel (User Cabang) ---

  @Get('absensi-mapel')
  @UseGuards(AccessControlGuard)
  getAbsensiMapel(
    @Query('kelasId') kelasId: string,
    @Query('silabusId') silabusId: string,
    @Query('tanggal') tanggal?: string
  ) {
    if (!kelasId || !silabusId) {
      throw new BadRequestException('kelasId dan silabusId wajib diisi');
    }
    return this.pembelajaranService.getAbsensiMapel(kelasId, silabusId, tanggal);
  }

  @Post('absensi-mapel/bulk')
  @UseGuards(AccessControlGuard)
  saveAbsensiMapelBulk(@Body() body: { kelasId: string; silabusId: string; tanggal: string; logs: any[] }) {
    return this.pembelajaranService.saveAbsensiMapelBulk(body.kelasId, body.silabusId, body.tanggal, body.logs);
  }

  @Delete('absensi-mapel')
  @UseGuards(AccessControlGuard)
  deleteAbsensiMapel(
    @Query('kelasId') kelasId: string,
    @Query('silabusId') silabusId?: string,
    @Query('mataPelajaranId') mataPelajaranId?: string,
    @Query('tanggal') tanggal?: string
  ) {
    if (!kelasId || !tanggal || (!silabusId && !mataPelajaranId)) {
      throw new BadRequestException('kelasId, tanggal, dan (silabusId atau mataPelajaranId) wajib diisi');
    }
    return this.pembelajaranService.deleteAbsensiMapel(kelasId, { silabusId, mataPelajaranId, tanggal });
  }

  // --- Laporan (Admin Pusat / Wilayah) ---

  @Get('laporan')
  @UseGuards(AccessControlGuard)
  @RequireScope('WILAYAH')
  getLaporan(
    @Query('wilayahId') wilayahId: string | undefined,
    @Query('cabangId') cabangId: string | undefined,
    @Query('mataPelajaranId') mataPelajaranId: string | undefined,
    @Query('mode') mode: 'weekly' | 'monthly' | 'semester',
    @Query('weekStart') weekStart: string | undefined,
    @Query('month') month: string | undefined,
    @Query('tahunAjaran') tahunAjaran: string | undefined,
    @Query('semester') semester: string | undefined,
    @Request() req: any
  ) {
    if (!mode) {
      throw new BadRequestException('mode wajib diisi (weekly|monthly|semester)');
    }
    return this.pembelajaranService.getLaporan(
      { wilayahId, cabangId, mataPelajaranId, mode, weekStart, month, tahunAjaran, semester },
      req.user
    );
  }

  // --- Ringkasan (Dashboard) — semua scope ---

  @Get('ringkasan')
  @UseGuards(AccessControlGuard)
  getRingkasan(
    @Query('mode') mode: 'weekly' | 'monthly' | 'semester' | 'yearly' | undefined,
    @Query('weekStart') weekStart: string | undefined,
    @Query('month') month: string | undefined,
    @Query('tahunAjaran') tahunAjaran: string | undefined,
    @Query('semester') semester: string | undefined,
    @Query('kelasId') kelasId: string | undefined,
    @Query('wilayahId') wilayahId: string | undefined,
    @Query('cabangId') cabangId: string | undefined,
    @Request() req: any
  ) {
    return this.pembelajaranService.getRingkasan(req.user, {
      mode,
      weekStart,
      month,
      tahunAjaran,
      semester,
      kelasId,
      wilayahId,
      cabangId
    });
  }
}
