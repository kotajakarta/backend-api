import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, Inject } from '@nestjs/common';
import { AbsensiService } from './absensi.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';
import { RequireScope } from '../../common/decorators/access-control.decorator.js';

@Controller('absensi')
export class AbsensiController {
  constructor(@Inject(AbsensiService) private readonly absensiService: AbsensiService) {}

  @Get('programs')
  @UseGuards(AccessControlGuard)
  getPrograms(
    @Query('activeOnly') activeOnly?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('cabangId') cabangId?: string,
    @Query('kelasId') kelasId?: string,
    @Request() req?: any
  ) {
    const userScope = req?.user?.scope;
    const pageNum = page ? Number(page) : undefined;
    const limitNum = limit ? Number(limit) : undefined;
    return this.absensiService.getPrograms(activeOnly === 'true', userScope, pageNum, limitNum, cabangId, kelasId);
  }

  @Post('programs/bulk-generate')
  @UseGuards(AccessControlGuard)
  @RequireScope('WILAYAH')
  generateProgramsBulk(@Request() req: any, @Body() body: { namePrefix: string; dayOfWeek?: number; daysOfWeek?: number[]; startMonth: string; endMonth: string }) {
    return this.absensiService.generateProgramsBulk(body, req.user);
  }

  @Post('programs')
  @UseGuards(AccessControlGuard)
  @RequireScope('WILAYAH')
  createProgram(@Request() req: any, @Body() data: any) {
    return this.absensiService.createProgram(data, req.user);
  }

  @Put('programs/:id')
  @UseGuards(AccessControlGuard)
  @RequireScope('WILAYAH')
  updateProgram(@Request() req: any, @Param('id') id: string, @Body() data: any) {
    return this.absensiService.updateProgram(id, data, req.user);
  }

  @Delete('programs/all')
  @UseGuards(AccessControlGuard)
  @RequireScope('WILAYAH')
  deleteAllPrograms(@Request() req: any) {
    return this.absensiService.deleteAllPrograms(req.user);
  }

  @Delete('programs/:id')
  @UseGuards(AccessControlGuard)
  @RequireScope('WILAYAH')
  deleteProgram(@Request() req: any, @Param('id') id: string) {
    return this.absensiService.deleteProgram(id, req.user);
  }

  @Get('kehadiran')
  @UseGuards(AccessControlGuard)
  getKehadiran(
    @Query('programId') programId: string,
    @Query('kelasId') kelasId?: string,
    @Query('cabangId') cabangId?: string,
    @Query('wilayahId') wilayahId?: string,
    @Request() req?: any
  ) {
    let effectiveWilayahId = wilayahId;
    let effectiveCabangId = cabangId;
    if (['CABANG', 'WALI_KELAS', 'GURU'].includes(req?.user?.scope)) {
      effectiveWilayahId = req.user.wilayahId;
      effectiveCabangId = req.user.cabangId;
    } else if (req?.user?.scope === 'WILAYAH') {
      effectiveWilayahId = req.user.wilayahId;
    }
    return this.absensiService.getKehadiran(programId, kelasId, effectiveCabangId, effectiveWilayahId, req?.user);
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
    const cabangId = ['CABANG', 'WALI_KELAS', 'GURU'].includes(req.user?.scope) ? req.user.cabangId : (body.cabangId || req.user?.cabangId);
    return this.absensiService.saveKehadiranBulk(body.programId, cabangId, body.logs, req.user);
  }

  @Get('kehadiran-guru')
  @UseGuards(AccessControlGuard)
  getKehadiranGuru(
    @Query('programId') programId: string,
    @Query('cabangId') cabangId?: string,
    @Query('wilayahId') wilayahId?: string,
    @Request() req?: any
  ) {
    let effectiveWilayahId = wilayahId;
    let effectiveCabangId = cabangId;
    if (['CABANG', 'WALI_KELAS', 'GURU'].includes(req?.user?.scope)) {
      effectiveWilayahId = req.user.wilayahId;
      effectiveCabangId = req.user.cabangId;
    } else if (req?.user?.scope === 'WILAYAH') {
      effectiveWilayahId = req.user.wilayahId;
    }
    return this.absensiService.getKehadiranGuru(programId, effectiveCabangId, effectiveWilayahId);
  }

  @Post('kehadiran-guru/bulk')
  @UseGuards(AccessControlGuard)
  saveKehadiranGuruBulk(@Body() body: { programId: string; cabangId?: string; logs: any[] }, @Request() req: any) {
    const cabangId = ['CABANG', 'WALI_KELAS', 'GURU'].includes(req.user?.scope) ? req.user.cabangId : (body.cabangId || req.user?.cabangId);
    return this.absensiService.saveKehadiranGuruBulk(body.programId, cabangId, body.logs, req.user);
  }
}
