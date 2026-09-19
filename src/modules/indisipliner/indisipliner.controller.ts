import { Controller, Get, Post, Patch, Delete, UseGuards, Request, Inject, Query, Body, Param } from '@nestjs/common';
import { IndisiplinerService } from './indisipliner.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';

@Controller('indisipliner')
export class IndisiplinerController {
  constructor(@Inject(IndisiplinerService) private readonly indisiplinerService: IndisiplinerService) {}

  // === STATS ===
  @Get('stats')
  @UseGuards(AccessControlGuard)
  getStats(@Request() req: any) {
    return this.indisiplinerService.getStats(req.user);
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

  @Delete('pengeluaran/:id')
  @UseGuards(AccessControlGuard)
  deletePengeluaran(@Param('id') id: string, @Request() req: any) {
    return this.indisiplinerService.deletePengeluaran(id, req.user);
  }
}
