import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, Inject } from '@nestjs/common';
import { AbsensiService } from './absensi.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';

@Controller('absensi')
export class AbsensiController {
  constructor(@Inject(AbsensiService) private readonly absensiService: AbsensiService) {}

  @Get('programs')
  @UseGuards(AccessControlGuard)
  getPrograms(
    @Query('activeOnly') activeOnly?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Request() req?: any
  ) {
    const userScope = req?.user?.scope;
    const pageNum = page ? Number(page) : undefined;
    const limitNum = limit ? Number(limit) : undefined;
    return this.absensiService.getPrograms(activeOnly === 'true', userScope, pageNum, limitNum);
  }

  @Post('programs/bulk-generate')
  @UseGuards(AccessControlGuard)
  generateProgramsBulk(@Body() body: { namePrefix: string; dayOfWeek: number; startMonth: string; endMonth: string }) {
    return this.absensiService.generateProgramsBulk(body);
  }

  @Post('programs')
  @UseGuards(AccessControlGuard)
  createProgram(@Body() data: any) {
    return this.absensiService.createProgram(data);
  }

  @Put('programs/:id')
  @UseGuards(AccessControlGuard)
  updateProgram(@Param('id') id: string, @Body() data: any) {
    return this.absensiService.updateProgram(id, data);
  }

  @Delete('programs/all')
  @UseGuards(AccessControlGuard)
  deleteAllPrograms(@Request() req: any) {
    return this.absensiService.deleteAllPrograms();
  }

  @Delete('programs/:id')
  @UseGuards(AccessControlGuard)
  deleteProgram(@Param('id') id: string) {
    return this.absensiService.deleteProgram(id);
  }

  @Get('kehadiran')
  @UseGuards(AccessControlGuard)
  getKehadiran(
    @Query('programId') programId: string,
    @Query('kelasId') kelasId: string,
    @Request() req: any
  ) {
    const cabangId = req.query.cabangId || req.user.cabangId;
    return this.absensiService.getKehadiran(programId, kelasId, cabangId);
  }

  @Get('rekap')
  @UseGuards(AccessControlGuard)
  getKehadiranRecap(
    @Query('wilayahId') wilayahId?: string,
    @Query('cabangId') cabangId?: string,
    @Query('kelasId') kelasId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('semester') semester?: string,
    @Query('tahunAjaran') tahunAjaran?: string,
    @Query('month') month?: string,
    @Request() req?: any
  ) {
    return this.absensiService.getKehadiranRecap({
      wilayahId,
      cabangId,
      kelasId,
      startDate,
      endDate,
      semester,
      tahunAjaran,
      month,
    }, req.user);
  }

  @Post('kehadiran/bulk')
  @UseGuards(AccessControlGuard)
  saveKehadiranBulk(@Body() body: { programId: string; cabangId?: string; logs: any[] }, @Request() req: any) {
    const cabangId = body.cabangId || req.user.cabangId;
    return this.absensiService.saveKehadiranBulk(body.programId, cabangId, body.logs);
  }

  @Get('kehadiran-guru')
  @UseGuards(AccessControlGuard)
  getKehadiranGuru(
    @Query('programId') programId: string,
    @Request() req: any
  ) {
    const cabangId = req.query.cabangId || req.user.cabangId;
    return this.absensiService.getKehadiranGuru(programId, cabangId);
  }

  @Post('kehadiran-guru/bulk')
  @UseGuards(AccessControlGuard)
  saveKehadiranGuruBulk(@Body() body: { programId: string; cabangId?: string; logs: any[] }, @Request() req: any) {
    const cabangId = body.cabangId || req.user.cabangId;
    return this.absensiService.saveKehadiranGuruBulk(body.programId, cabangId, body.logs);
  }
}
