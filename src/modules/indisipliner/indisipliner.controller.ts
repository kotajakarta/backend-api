import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  UseGuards,
  Request,
  Response,
  Inject,
  Query,
  Body,
  Param,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response as ExpressResponse } from 'express';
import { IndisiplinerService } from './indisipliner.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';
import { AllowCookieAuth } from '../../common/decorators/access-control.decorator.js';

@Controller('indisipliner')
export class IndisiplinerController {
  constructor(@Inject(IndisiplinerService) private readonly indisiplinerService: IndisiplinerService) {}

  // === STATS ===
  @Get('stats')
  @UseGuards(AccessControlGuard)
  getStats(@Request() req: any) {
    return this.indisiplinerService.getStats(req.user);
  }

  // === UPLOAD BERKAS (PDF / GAMBAR) ===
  @Post('upload')
  @UseGuards(AccessControlGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  async uploadDokumen(
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('File berkas wajib diunggah.');
    return this.indisiplinerService.uploadDokumen(file);
  }

  // === TEMPLATE DOCX SP & PENGELUARAN ===
  @Get('template/sp/:tingkat')
  @AllowCookieAuth()
  @UseGuards(AccessControlGuard)
  async downloadSpTemplate(
    @Param('tingkat') tingkat: string,
    @Query('id') spId: string,
    @Response() res: ExpressResponse,
  ) {
    const buffer = await this.indisiplinerService.getSpTemplateDocx(tingkat, spId);
    const sanitizedTingkat = tingkat.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const filename = spId ? `Surat_Peringatan_${sanitizedTingkat}.docx` : `Template_SP_${sanitizedTingkat}.docx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Get('template/pengeluaran')
  @AllowCookieAuth()
  @UseGuards(AccessControlGuard)
  async downloadPengeluaranTemplate(
    @Query('id') pengeluaranId: string,
    @Response() res: ExpressResponse,
  ) {
    const buffer = await this.indisiplinerService.getPengeluaranTemplateDocx(pengeluaranId);
    const filename = pengeluaranId ? 'SK_Pengeluaran_Santri.docx' : 'Template_SK_Pengeluaran_Santri.docx';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  // === PELANGGARAN ===
  @Get('pelanggaran')
  @UseGuards(AccessControlGuard)
  getPelanggaran(@Query() query: any, @Request() req: any) {
    return this.indisiplinerService.getPelanggaran(query, req.user);
  }

  @Post('pelanggaran')
  @UseGuards(AccessControlGuard)
  createPelanggaran(@Body() body: any, @Request() req: any) {
    return this.indisiplinerService.createPelanggaran(body, req.user);
  }

  @Patch('pelanggaran/:id/status')
  @UseGuards(AccessControlGuard)
  updatePelanggaranStatus(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.indisiplinerService.updatePelanggaranStatus(id, body.status, req.user);
  }

  @Put('pelanggaran/:id')
  @UseGuards(AccessControlGuard)
  updatePelanggaran(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.indisiplinerService.updatePelanggaran(id, body, req.user);
  }

  @Delete('pelanggaran/:id')
  @UseGuards(AccessControlGuard)
  deletePelanggaran(@Param('id') id: string, @Request() req: any) {
    return this.indisiplinerService.deletePelanggaran(id, req.user);
  }

  // === SURAT PERINGATAN (SP) ===
  @Get('sp')
  @UseGuards(AccessControlGuard)
  getSp(@Query() query: any, @Request() req: any) {
    return this.indisiplinerService.getSp(query, req.user);
  }

  @Post('sp')
  @UseGuards(AccessControlGuard)
  createSp(@Body() body: any, @Request() req: any) {
    return this.indisiplinerService.createSp(body, req.user);
  }

  @Patch('sp/:id/status')
  @UseGuards(AccessControlGuard)
  updateSpStatus(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.indisiplinerService.updateSpStatus(id, body.status, req.user);
  }

  @Patch('sp/:id/status-approval')
  @UseGuards(AccessControlGuard)
  updateSpStatusApproval(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.indisiplinerService.updateSpStatusApproval(id, body.statusApproval || body.status, req.user);
  }

  @Put('sp/:id')
  @UseGuards(AccessControlGuard)
  updateSp(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.indisiplinerService.updateSp(id, body, req.user);
  }

  @Delete('sp/:id')
  @UseGuards(AccessControlGuard)
  deleteSp(@Param('id') id: string, @Request() req: any) {
    return this.indisiplinerService.deleteSp(id, req.user);
  }

  // === PENGELUARAN SISWA ===
  @Get('pengeluaran')
  @UseGuards(AccessControlGuard)
  getPengeluaran(@Query() query: any, @Request() req: any) {
    return this.indisiplinerService.getPengeluaran(query, req.user);
  }

  @Post('pengeluaran')
  @UseGuards(AccessControlGuard)
  createPengeluaran(@Body() body: any, @Request() req: any) {
    return this.indisiplinerService.createPengeluaran(body, req.user);
  }

  @Patch('pengeluaran/:id/status')
  @UseGuards(AccessControlGuard)
  updatePengeluaranStatus(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.indisiplinerService.updatePengeluaranStatus(id, body.status, req.user);
  }

  @Put('pengeluaran/:id')
  @UseGuards(AccessControlGuard)
  updatePengeluaran(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.indisiplinerService.updatePengeluaran(id, body, req.user);
  }

  @Delete('pengeluaran/:id')
  @UseGuards(AccessControlGuard)
  deletePengeluaran(@Param('id') id: string, @Request() req: any) {
    return this.indisiplinerService.deletePengeluaran(id, req.user);
  }
}
