import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, Inject } from '@nestjs/common';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';
import { RequireScope } from '../../common/decorators/access-control.decorator.js';
import { SyahriyahService } from './syahriyah.service.js';

@Controller('syahriyah-admin')
@UseGuards(AccessControlGuard)
@RequireScope('CABANG')
export class SyahriyahAdminController {
  constructor(@Inject(SyahriyahService) private readonly syahriyahService: SyahriyahService) {}

  // 1. STATISTIK & TAGIHAN
  @Get('stats')
  getStats(@Request() req: any, @Query() query: any) {
    return this.syahriyahService.getSyahriyahStats(query, req.user);
  }

  @Get('tagihan')
  getTagihanList(@Request() req: any, @Query() query: any) {
    return this.syahriyahService.getTagihanList(query, req.user);
  }

  @Post('tagihan')
  createTagihan(@Request() req: any, @Body() body: any) {
    return this.syahriyahService.createTagihan(body, req.user);
  }

  @Post('tagihan/generate-massal')
  generateMassal(@Request() req: any, @Body() body: any) {
    return this.syahriyahService.generateTagihanMassal(body, req.user);
  }

  @Post('tagihan/generate-bulanan')
  generateBulanan(@Request() req: any, @Body() body: any) {
    return this.syahriyahService.generateTagihanMassal(body, req.user);
  }

  @Delete('tagihan/massal')
  deleteTagihanMassal(@Request() req: any, @Query() query: any) {
    return this.syahriyahService.deleteTagihanMassal(query, req.user);
  }

  @Delete('tagihan/:id')
  deleteTagihan(@Request() req: any, @Param('id') id: string) {
    return this.syahriyahService.deleteTagihan(id, req.user);
  }

  @Post('tagihan/:id/bayar-langsung')
  bayarLangsung(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.syahriyahService.bayarLangsungKasir(id, body, req.user);
  }

  @Put('pembayaran/:id/verifikasi')
  verifikasiPembayaran(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.syahriyahService.verifikasiPembayaran(id, body, req.user);
  }

  // 2. MASTER TARIF BIAYA
  @Get('tarif')
  getTarif(@Request() req: any) {
    return this.syahriyahService.getTarifList(req.user);
  }

  @Post('tarif')
  createTarif(@Request() req: any, @Body() body: any) {
    return this.syahriyahService.createTarif(body, req.user);
  }

  @Put('tarif/:id')
  updateTarif(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.syahriyahService.updateTarif(id, body, req.user);
  }

  @Delete('tarif/:id')
  deleteTarif(@Request() req: any, @Param('id') id: string) {
    return this.syahriyahService.deleteTarif(id, req.user);
  }

  // 3. MASTER REKENING BANK
  @Get('rekening')
  getRekening(@Request() req: any) {
    return this.syahriyahService.getRekeningList(req.user);
  }

  @Post('rekening')
  createRekening(@Request() req: any, @Body() body: any) {
    return this.syahriyahService.createRekening(body, req.user);
  }

  @Put('rekening/:id')
  updateRekening(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.syahriyahService.updateRekening(id, body, req.user);
  }

  @Delete('rekening/:id')
  deleteRekening(@Request() req: any, @Param('id') id: string) {
    return this.syahriyahService.deleteRekening(id, req.user);
  }
}
