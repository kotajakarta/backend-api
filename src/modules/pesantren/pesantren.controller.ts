import { Controller, Get, Post, Put, Delete, UseGuards, Inject, Body, Param, Request } from '@nestjs/common';
import { PesantrenService } from './pesantren.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';
import { RequireDivisi, RequireScope } from '../../common/decorators/access-control.decorator.js';

@Controller('pesantren')
@UseGuards(AccessControlGuard)
@RequireDivisi('PESANTREN')
export class PesantrenController {
  constructor(@Inject(PesantrenService) private readonly pesantrenService: PesantrenService) {}

  @Get('grup-daimi')
  getGrupDaimi(@Request() req: any) {
    return this.pesantrenService.getGrupDaimi(req.user);
  }

  @Post('grup-daimi')
  createGrupDaimi(@Request() req: any, @Body() data: { name: string; jenis?: string; ketuaId?: string; cabangId?: string }) {
    if (req.user.scope === 'CABANG') {
      data.cabangId = req.user.cabangId;
    }
    return this.pesantrenService.createGrupDaimi(data);
  }

  @Put('grup-daimi/:id')
  updateGrupDaimi(@Request() req: any, @Param('id') id: string, @Body() data: { name: string; jenis?: string; ketuaId?: string; cabangId?: string }) {
    if (req.user.scope === 'CABANG') {
      data.cabangId = req.user.cabangId;
    }
    return this.pesantrenService.updateGrupDaimi(id, data);
  }

  @Delete('grup-daimi/:id')
  deleteGrupDaimi(@Param('id') id: string) {
    return this.pesantrenService.deleteGrupDaimi(id);
  }

  // Student Assignment routes for Daimi Group
  @Get('grup-daimi/:id/students')
  getStudentsInGrupDaimi(@Param('id') id: string) {
    return this.pesantrenService.getStudentsInGrupDaimi(id);
  }

  @Post('grup-daimi/:id/students')
  addStudentToGrupDaimi(@Param('id') id: string, @Body() data: { studentId: string }) {
    return this.pesantrenService.addStudentToGrupDaimi(id, data.studentId);
  }

  @Delete('grup-daimi/:id/students/:studentId')
  removeStudentFromGrupDaimi(@Param('id') id: string, @Param('studentId') studentId: string) {
    return this.pesantrenService.removeStudentFromGrupDaimi(id, studentId);
  }

  // Master data "Jenis Grup Daimi" - daftar terkelola untuk field GrupDaimi.jenis,
  // menggantikan array hardcoded JENIS_DAIMI_OPTIONS supaya nilainya konsisten.
  @Get('jenis-grup-daimi')
  getJenisGrupDaimi() {
    return this.pesantrenService.getJenisGrupDaimi();
  }

  @Post('jenis-grup-daimi')
  @RequireScope('GLOBAL')
  createJenisGrupDaimi(@Body() data: { name: string }) {
    return this.pesantrenService.createJenisGrupDaimi(data);
  }

  @Put('jenis-grup-daimi/:id')
  @RequireScope('GLOBAL')
  updateJenisGrupDaimi(@Param('id') id: string, @Body() data: { name: string }) {
    return this.pesantrenService.updateJenisGrupDaimi(id, data);
  }

  @Delete('jenis-grup-daimi/:id')
  @RequireScope('GLOBAL')
  deleteJenisGrupDaimi(@Param('id') id: string) {
    return this.pesantrenService.deleteJenisGrupDaimi(id);
  }
}
