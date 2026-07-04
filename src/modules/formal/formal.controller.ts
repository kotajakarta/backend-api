import { Controller, Get, Post, Put, Patch, Delete, Body, Param, UseGuards, Request, Inject } from '@nestjs/common';
import { FormalService } from './formal.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';

@Controller('formal')
export class FormalController {
  constructor(@Inject(FormalService) private readonly formalService: FormalService) {}

  @Get('kelas')
  @UseGuards(AccessControlGuard)
  getKelas(@Request() req: any) {
    return this.formalService.getKelas(req.user);
  }

  @Post('kelas/import')
  @UseGuards(AccessControlGuard)
  importKelas(@Request() req: any, @Body() data: any[]) {
    return this.formalService.importKelas(req.user, data);
  }

  @Post('kelas')
  @UseGuards(AccessControlGuard)
  createKelas(@Request() req: any, @Body() data: { name: string, tingkat?: string, isActive?: boolean, cabangId?: string }) {
    if (req.user.scope === 'CABANG') {
      data.cabangId = req.user.cabangId;
    }
    return this.formalService.createKelas(data);
  }

  @Put('kelas/:id')
  @UseGuards(AccessControlGuard)
  updateKelas(@Request() req: any, @Param('id') id: string, @Body() data: { name: string, tingkat?: string, cabangId?: string }) {
    if (req.user.scope === 'CABANG') {
      data.cabangId = req.user.cabangId;
    }
    return this.formalService.updateKelas(id, data);
  }

  @Patch('kelas/:id/status')
  @UseGuards(AccessControlGuard)
  toggleKelasStatus(@Param('id') id: string, @Body() data: { isActive: boolean }) {
    return this.formalService.toggleKelasStatus(id, data.isActive);
  }

  @Delete('kelas/all')
  @UseGuards(AccessControlGuard)
  deleteAllKelas(@Request() req: any) {
    return this.formalService.deleteAllKelas(req.user);
  }

  @Delete('kelas/:id')
  @UseGuards(AccessControlGuard)
  deleteKelas(@Request() req: any, @Param('id') id: string) {
    return this.formalService.deleteKelas(id);
  }

  @Get('rapor')
  @UseGuards(AccessControlGuard)
  getRapor() {
    return this.formalService.getRapor();
  }

  @Post('rapor')
  @UseGuards(AccessControlGuard)
  createRapor(@Body() data: any) {
    return this.formalService.createRapor(data);
  }

  @Put('rapor/:id')
  @UseGuards(AccessControlGuard)
  updateRapor(@Param('id') id: string, @Body() data: any) {
    return this.formalService.updateRapor(id, data);
  }

  @Delete('rapor/:id')
  @UseGuards(AccessControlGuard)
  deleteRapor(@Param('id') id: string) {
    return this.formalService.deleteRapor(id);
  }

  @Get('siswa')
  @UseGuards(AccessControlGuard)
  getSiswaFormal(@Request() req: any) {
    return this.formalService.getSiswaFormal(req.user);
  }

  @Put('siswa/:id')
  @UseGuards(AccessControlGuard)
  updateSiswaFormal(@Param('id') id: string, @Body() data: { nis?: string, nisn?: string, kelasId?: string }) {
    return this.formalService.updateSiswaFormal(id, data);
  }

  // --- MATA PELAJARAN ---

  @Get('mapel')
  @UseGuards(AccessControlGuard)
  getMapel() {
    return this.formalService.getMapel();
  }

  @Post('mapel')
  @UseGuards(AccessControlGuard)
  createMapel(@Body() data: { kodeMapel: string, name: string, grupMapel: string, isActive?: boolean }) {
    return this.formalService.createMapel(data);
  }

  @Put('mapel/:id')
  @UseGuards(AccessControlGuard)
  updateMapel(@Param('id') id: string, @Body() data: { kodeMapel?: string, name?: string, grupMapel?: string, isActive?: boolean }) {
    return this.formalService.updateMapel(id, data);
  }

  @Delete('mapel/:id')
  @UseGuards(AccessControlGuard)
  deleteMapel(@Param('id') id: string) {
    return this.formalService.deleteMapel(id);
  }

  // --- KEAKTIFAN MAPEL GRUP ---
  
  @Get('mapel-grup')
  @UseGuards(AccessControlGuard)
  getKeaktifanMapelGrup() {
    return this.formalService.getKeaktifanMapelGrup();
  }

  @Post('mapel-grup/toggle')
  @UseGuards(AccessControlGuard)
  toggleKeaktifanMapelGrup(@Body() data: { mataPelajaranId: string, grupDaimiId: string, isActive: boolean }) {
    return this.formalService.toggleKeaktifanMapelGrup(data);
  }
}
