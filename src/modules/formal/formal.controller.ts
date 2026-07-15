import { Controller, Get, Post, Put, Patch, Delete, Body, Param, UseGuards, Request, Inject, UseInterceptors, UploadedFile, Res, BadRequestException } from '@nestjs/common';
import { FormalService } from './formal.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';

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
    return this.formalService.createKelas(data, req.user);
  }

  @Put('kelas/:id')
  @UseGuards(AccessControlGuard)
  updateKelas(@Request() req: any, @Param('id') id: string, @Body() data: { name: string, tingkat?: string, cabangId?: string }) {
    if (req.user.scope === 'CABANG') {
      data.cabangId = req.user.cabangId;
    }
    return this.formalService.updateKelas(id, data, req.user);
  }

  @Patch('kelas/:id/status')
  @UseGuards(AccessControlGuard)
  toggleKelasStatus(@Request() req: any, @Param('id') id: string, @Body() data: { isActive: boolean }) {
    return this.formalService.toggleKelasStatus(id, data.isActive, req.user);
  }

  @Delete('kelas/all')
  @UseGuards(AccessControlGuard)
  deleteAllKelas(@Request() req: any) {
    return this.formalService.deleteAllKelas(req.user);
  }

  @Delete('kelas/:id')
  @UseGuards(AccessControlGuard)
  deleteKelas(@Request() req: any, @Param('id') id: string) {
    return this.formalService.deleteKelas(id, req.user);
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
  updateSiswaFormal(@Request() req: any, @Param('id') id: string, @Body() data: { nis?: string, nisn?: string, kelasId?: string, isVerval?: boolean }) {
    return this.formalService.updateSiswaFormal(id, data, req.user);
  }

  // --- MATA PELAJARAN ---

  @Get('mapel')
  @UseGuards(AccessControlGuard)
  getMapel() {
    return this.formalService.getMapel();
  }

  @Post('mapel')
  @UseGuards(AccessControlGuard)
  createMapel(@Request() req: any, @Body() data: { kodeMapel: string, name: string, grupMapel: string, isActive?: boolean }) {
    return this.formalService.createMapel(data, req.user);
  }

  @Put('mapel/:id')
  @UseGuards(AccessControlGuard)
  updateMapel(@Request() req: any, @Param('id') id: string, @Body() data: { kodeMapel?: string, name?: string, grupMapel?: string, isActive?: boolean }) {
    return this.formalService.updateMapel(id, data, req.user);
  }

  @Delete('mapel/:id')
  @UseGuards(AccessControlGuard)
  deleteMapel(@Request() req: any, @Param('id') id: string) {
    return this.formalService.deleteMapel(id, req.user);
  }

  // --- KEAKTIFAN MAPEL GRUP ---
  
  @Get('mapel-grup')
  @UseGuards(AccessControlGuard)
  getKeaktifanMapelGrup() {
    return this.formalService.getKeaktifanMapelGrup();
  }

  @Post('mapel-grup/toggle')
  @UseGuards(AccessControlGuard)
  toggleKeaktifanMapelGrup(@Request() req: any, @Body() data: { mataPelajaranId: string, grupDaimiId: string, isActive: boolean }) {
    return this.formalService.toggleKeaktifanMapelGrup(data, req.user);
  }

  // --- RIWAYAT KELAS FORMAL ---
  
  @Get('riwayat-kelas/student/:studentId')
  @UseGuards(AccessControlGuard)
  getRiwayatKelasByStudent(@Param('studentId') studentId: string) {
    return this.formalService.getRiwayatKelasByStudent(studentId);
  }

  @Post('riwayat-kelas')
  @UseGuards(AccessControlGuard)
  createRiwayatKelas(@Request() req: any, @Body() data: { studentId: string, kelasId: string, tahunAjaran: string, semester: string, statusAkhir?: string, waliKelasId?: string, catatan?: string }) {
    return this.formalService.createRiwayatKelas(data, req.user);
  }

  @Put('riwayat-kelas/:id')
  @UseGuards(AccessControlGuard)
  updateRiwayatKelas(@Request() req: any, @Param('id') id: string, @Body() data: { kelasId?: string, tahunAjaran?: string, semester?: string, statusAkhir?: string, waliKelasId?: string, catatan?: string }) {
    return this.formalService.updateRiwayatKelas(id, data, req.user);
  }

  @Delete('riwayat-kelas/:id')
  @UseGuards(AccessControlGuard)
  deleteRiwayatKelas(@Request() req: any, @Param('id') id: string) {
    return this.formalService.deleteRiwayatKelas(id, req.user);
  }

  @Post('kelas/naik-kelas-massal')
  @UseGuards(AccessControlGuard)
  prosesKenaikanKelasMassal(@Request() req: any, @Body() data: any) {
    return this.formalService.prosesKenaikanKelasMassal(data, req.user);
  }

  @Get('kelas/:id/students')
  @UseGuards(AccessControlGuard)
  getStudentsByKelas(@Param('id') id: string) {
    return this.formalService.getStudentsByKelas(id);
  }

  @Get('guru-mapel-kelas')
  @UseGuards(AccessControlGuard)
  getGuruMapelKelas(@Request() req: any) {
    return this.formalService.getGuruMapelKelas(req.user);
  }

  @Post('guru-mapel-kelas')
  @UseGuards(AccessControlGuard)
  createGuruMapelKelas(@Request() req: any, @Body() data: { staffId: string, mataPelajaranId: string, kelasId: string }) {
    return this.formalService.createGuruMapelKelas(req.user, data);
  }

  @Delete('guru-mapel-kelas/:id')
  @UseGuards(AccessControlGuard)
  deleteGuruMapelKelas(@Request() req: any, @Param('id') id: string) {
    return this.formalService.deleteGuruMapelKelas(req.user, id);
  }

  @Get('muadalah')
  @UseGuards(AccessControlGuard)
  getLembagaMuadalah() {
    return this.formalService.getLembagaMuadalah();
  }

  @Post('muadalah/upload')
  @UseGuards(AccessControlGuard)
  @UseInterceptors(FileInterceptor('file'))
  uploadFile(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('File is required');
    
    // Generate a simple unique filename
    const ext = path.extname(file.originalname);
    const filename = `muadalah_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`;
    const uploadDir = path.join(process.cwd(), 'uploads');
    
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, file.buffer);

    return {
      url: `/formal/muadalah/uploads/${filename}`,
      filename: filename
    };
  }

  @Get('muadalah/uploads/:filename')
  serveFile(@Param('filename') filename: string, @Res() res: Response) {
    const filePath = path.join(process.cwd(), 'uploads', filename);
    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }
    return res.status(404).send('File not found');
  }

  @Post('muadalah')
  @UseGuards(AccessControlGuard)
  createLembagaMuadalah(@Request() req: any, @Body() data: { name: string; code: string; npsn?: string; nspp?: string; namaKetua?: string; ttdKetua?: string; skSpm?: string; isActive?: boolean }) {
    return this.formalService.createLembagaMuadalah(data, req.user);
  }

  @Put('muadalah/:id')
  @UseGuards(AccessControlGuard)
  updateLembagaMuadalah(@Request() req: any, @Param('id') id: string, @Body() data: { name: string; code: string; npsn?: string; nspp?: string; namaKetua?: string; ttdKetua?: string; skSpm?: string }) {
    return this.formalService.updateLembagaMuadalah(id, data, req.user);
  }

  @Patch('muadalah/:id/status')
  @UseGuards(AccessControlGuard)
  toggleLembagaMuadalahStatus(@Request() req: any, @Param('id') id: string, @Body() data: { isActive: boolean }) {
    return this.formalService.toggleLembagaMuadalahStatus(id, data.isActive, req.user);
  }

  @Delete('muadalah/:id')
  @UseGuards(AccessControlGuard)
  deleteLembagaMuadalah(@Request() req: any, @Param('id') id: string) {
    return this.formalService.deleteLembagaMuadalah(id, req.user);
  }
}
