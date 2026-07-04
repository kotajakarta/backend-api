import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, Inject } from '@nestjs/common';
import { StudentService } from './student.service.js';
import { AccessControlGuard } from '../../../common/guards/access-control.guard.js';
import { StatusPool } from '@prisma/client';

@Controller('students')
export class StudentController {
  constructor(@Inject(StudentService) private readonly studentService: StudentService) {}

  @Get()
  @UseGuards(AccessControlGuard)
  getStudents(@Request() req: any) {
    return this.studentService.getStudents(req.user);
  }

  @Get('export/detail')
  @UseGuards(AccessControlGuard)
  exportStudentDetail(@Request() req: any) {
    return this.studentService.exportStudentDetail(req.user);
  }

  @Post()
  @UseGuards(AccessControlGuard)
  createStudent(@Request() req: any, @Body() data: any) {
    return this.studentService.createStudent(req.user, data);
  }

  @Put(':id')
  @UseGuards(AccessControlGuard)
  updateStudent(@Param('id') id: string, @Body() data: any) {
    return this.studentService.updateStudent(id, data);
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
  deleteStudent(@Param('id') id: string) {
    return this.studentService.deleteStudent(id);
  }

  @Get('pool')
  @UseGuards(AccessControlGuard)
  getPoolStudents(@Request() req: any) {
    return this.studentService.getPoolStudents(req.user);
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
  tarikMassalSiswa(@Body() dto: { studentIds: string[], cabangId: string }) {
    return this.studentService.tarikMassalSiswa(dto.studentIds, dto.cabangId);
  }

  @Post(':id/tarik')
  @UseGuards(AccessControlGuard)
  tarikSiswa(@Param('id') id: string, @Body('cabangId') cabangId: string) {
    return this.studentService.tarikSiswa(id, cabangId);
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
}
