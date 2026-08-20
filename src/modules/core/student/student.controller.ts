import { Controller, Get, Post, Put, Delete, Body, Param, Query, Res, UseGuards, Request, Inject, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { StudentService, DOKUMEN_JENIS, DokumenJenis } from './student.service.js';
import { AccessControlGuard } from '../../../common/guards/access-control.guard.js';
import { AllowCookieAuth } from '../../../common/decorators/access-control.decorator.js';
import { StatusPool } from '@prisma/client';

@Controller('students')
export class StudentController {
  constructor(@Inject(StudentService) private readonly studentService: StudentService) {}

  @Get()
  @UseGuards(AccessControlGuard)
  getStudents(@Request() req: any) {
    return this.studentService.getStudents(req.user);
  }

  @Get('photo-thumbnail')
  @UseGuards(AccessControlGuard)
  @AllowCookieAuth()
  getPhotoThumbnail(@Query('url') photoUrl: string, @Res() res: any) {
    return this.studentService.getPhotoThumbnail(photoUrl, res);
  }

  @Get('export/detail')
  @UseGuards(AccessControlGuard)
  exportStudentDetail(@Request() req: any) {
    return this.studentService.exportStudentDetail(req.user);
  }

  @Get('check-duplicate')
  checkDuplicate(
    @Query('nik') nik?: string,
    @Query('nisn') nisn?: string,
    @Query('excludeStudentId') excludeStudentId?: string
  ) {
    return this.studentService.checkDuplicate({ nik, nisn, excludeStudentId });
  }

  @Get('residu')
  @UseGuards(AccessControlGuard)
  getResiduStudents(@Request() req: any) {
    return this.studentService.getResiduStudents(req.user);
  }

  @Post()
  @UseGuards(AccessControlGuard)
  createStudent(@Request() req: any, @Body() data: any) {
    return this.studentService.createStudent(req.user, data);
  }

  @Put(':id')
  @UseGuards(AccessControlGuard)
  updateStudent(@Param('id') id: string, @Body() data: any, @Request() req: any) {
    return this.studentService.updateStudent(id, data, req.user);
  }

  @Delete('all')
  @UseGuards(AccessControlGuard)
  deleteAllStudents(@Request() req: any) {
    return this.studentService.deleteAllStudents(req.user);
  }

  @Delete('pool/all')
  @UseGuards(AccessControlGuard)
  deletePoolStudents(@Request() req: any) {
    return this.studentService.deletePoolStudents(req.user);
  }

  @Delete(':id')
  @UseGuards(AccessControlGuard)
  deleteStudent(@Param('id') id: string, @Request() req: any) {
    return this.studentService.deleteStudent(id, req.user);
  }

  @Get('pool')
  @UseGuards(AccessControlGuard)
  getPoolStudents(@Query() query: { search?: string; limit?: string }, @Request() req: any) {
    return this.studentService.getPoolStudents(req.user, query);
  }

  @Get('daftar-ulang/list')
  @UseGuards(AccessControlGuard)
  getDaftarUlangList(@Request() req: any) {
    return this.studentService.getDaftarUlangList(req.user);
  }

  @Get('permintaan-tarik/pending-count')
  @UseGuards(AccessControlGuard)
  getPendingPermintaanCount() {
    return this.studentService.getPendingPermintaanCount();
  }

  @Get('permintaan-tarik')
  @UseGuards(AccessControlGuard)
  getPermintaanTarik(@Request() req: any) {
    return this.studentService.getPermintaanTarik(req.user);
  }

  @Get(':id')
  @UseGuards(AccessControlGuard)
  getStudentById(@Param('id') id: string, @Request() req: any) {
    return this.studentService.getStudentById(id, req.user);
  }

  @Post('permintaan-tarik/:id/approve')
  @UseGuards(AccessControlGuard)
  approvePermintaanTarik(@Param('id') id: string, @Request() req: any) {
    return this.studentService.approvePermintaanTarik(id, req.user);
  }

  @Post('permintaan-tarik/:id/reject')
  @UseGuards(AccessControlGuard)
  rejectPermintaanTarik(@Param('id') id: string, @Request() req: any) {
    return this.studentService.rejectPermintaanTarik(id, req.user);
  }

  @Post('import')
  @UseGuards(AccessControlGuard)
  importStudents(@Request() req: any, @Body() data: any[]) {
    return this.studentService.importStudents(req.user, data);
  }

  @Post('pool/tarik-massal')
  @UseGuards(AccessControlGuard)
  tarikMassalSiswa(@Body() dto: { studentIds: string[], cabangId?: string }, @Request() req: any) {
    const cabangId = req.user?.scope === 'CABANG' ? req.user.cabangId : (dto.cabangId || req.user?.cabangId);
    return this.studentService.tarikMassalSiswa(dto.studentIds, cabangId, req.user);
  }

  @Post('lepas-massal')
  @UseGuards(AccessControlGuard)
  lepasMassalSiswa(
    @Body() dto: { studentIds: string[]; statusAkhir: StatusPool; catatan?: string },
    @Request() req: any
  ) {
    return this.studentService.lepasMassalSiswa(dto.studentIds, dto, req.user);
  }

  @Post(':id/tarik')
  @UseGuards(AccessControlGuard)
  tarikSiswa(@Param('id') id: string, @Body('cabangId') cabangIdInput: string, @Request() req: any) {
    const cabangId = req.user?.scope === 'CABANG' ? req.user.cabangId : (cabangIdInput || req.user?.cabangId);
    return this.studentService.tarikSiswa(id, cabangId, req.user);
  }

  @Post(':id/lepas')
  @UseGuards(AccessControlGuard)
  lepasSiswa(
    @Param('id') id: string,
    @Body() dto: { statusAkhir: StatusPool; catatan?: string },
    @Request() req: any
  ) {
    return this.studentService.lepasSiswa(id, dto, req.user);
  }

  // --- PUBLIC ENDPOINTS ---

  @Post('daftar-ulang/verify')
  verifyDaftarUlang(@Body() data: { nik: string, kodeDaftarUlang: string }) {
    return this.studentService.verifyDaftarUlang(data);
  }

  @Post('daftar-ulang/submit')
  submitDaftarUlang(@Body() data: any) {
    return this.studentService.submitDaftarUlang(data);
  }

  // Upload dokumen sementara untuk daftar ulang (sebelum biodata terbentuk)
  // POST /students/daftar-ulang/upload-temp/:jenis
  @Post('daftar-ulang/upload-temp/:jenis')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadDokumenPublikTemp(
    @Param('jenis') jenis: string,
    @UploadedFile() file: Express.Multer.File
  ) {
    if (!DOKUMEN_JENIS.includes(jenis as DokumenJenis)) {
      throw new BadRequestException(`Jenis dokumen tidak valid. Pilihan: ${DOKUMEN_JENIS.join(', ')}`);
    }
    if (!file) throw new BadRequestException('File harus dilampirkan');
    return this.studentService.uploadTemp(jenis as DokumenJenis, file);
  }

  // Upload dokumen untuk daftar ulang (publik, tidak perlu login)
  // POST /students/daftar-ulang/upload/:biodataId/:jenis
  @Post('daftar-ulang/upload/:biodataId/:jenis')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadDokumenPublik(
    @Param('biodataId') biodataId: string,
    @Param('jenis') jenis: string,
    @UploadedFile() file: Express.Multer.File
  ) {
    if (!DOKUMEN_JENIS.includes(jenis as DokumenJenis)) {
      throw new BadRequestException(`Jenis dokumen tidak valid. Pilihan: ${DOKUMEN_JENIS.join(', ')}`);
    }
    if (!file) throw new BadRequestException('File harus dilampirkan');
    return this.studentService.uploadDokumenPublik(biodataId, jenis as DokumenJenis, file);
  }

  // Upload dokumen sementara untuk admin (sebelum siswa terbentuk)
  // POST /students/upload-temp/:jenis
  @Post('upload-temp/:jenis')
  @UseGuards(AccessControlGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadDokumenSiswaTemp(
    @Param('jenis') jenis: string,
    @UploadedFile() file: Express.Multer.File
  ) {
    if (!DOKUMEN_JENIS.includes(jenis as DokumenJenis)) {
      throw new BadRequestException(`Jenis dokumen tidak valid. Pilihan: ${DOKUMEN_JENIS.join(', ')}`);
    }
    if (!file) throw new BadRequestException('File harus dilampirkan');
    return this.studentService.uploadTemp(jenis as DokumenJenis, file);
  }

  // Upload dokumen siswa (perlu login)
  // POST /students/:id/upload/:jenis
  @Post(':id/upload/:jenis')
  @UseGuards(AccessControlGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadDokumenSiswa(
    @Request() req: any,
    @Param('id') id: string,
    @Param('jenis') jenis: string,
    @UploadedFile() file: Express.Multer.File
  ) {
    if (!DOKUMEN_JENIS.includes(jenis as DokumenJenis)) {
      throw new BadRequestException(`Jenis dokumen tidak valid. Pilihan: ${DOKUMEN_JENIS.join(', ')}`);
    }
    if (!file) throw new BadRequestException('File harus dilampirkan');
    return this.studentService.uploadDokumenSiswa(id, jenis as DokumenJenis, file, req.user);
  }
}

