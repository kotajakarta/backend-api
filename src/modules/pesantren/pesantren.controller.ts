import { Controller, Get, Post, Put, Delete, UseGuards, Inject, Body, Param } from '@nestjs/common';
import { PesantrenService } from './pesantren.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';
import { RequireDivisi } from '../../common/decorators/access-control.decorator.js';

@Controller('pesantren')
@UseGuards(AccessControlGuard)
@RequireDivisi('PESANTREN')
export class PesantrenController {
  constructor(@Inject(PesantrenService) private readonly pesantrenService: PesantrenService) {}

  @Get('grup-daimi')
  getGrupDaimi() {
    return this.pesantrenService.getGrupDaimi();
  }

  @Post('grup-daimi')
  createGrupDaimi(@Body() data: { name: string; jenis?: string; ketuaId?: string }) {
    return this.pesantrenService.createGrupDaimi(data);
  }

  @Put('grup-daimi/:id')
  updateGrupDaimi(@Param('id') id: string, @Body() data: { name: string; jenis?: string; ketuaId?: string }) {
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
}
