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
  generateProgramsBulk(@Request() req: any, @Body() body: { namePrefix: string; dayOfWeek: number; startMonth: string; endMonth: string }) {
    return this.absensiService.generateProgramsBulk(body, req.user);
  }

  @Post('programs')
  @UseGuards(AccessControlGuard)
  createProgram(@Request() req: any, @Body() data: any) {
    return this.absensiService.createProgram(data, req.user);
  }

  @Put('programs/:id')
  @UseGuards(AccessControlGuard)
  updateProgram(@Request() req: any, @Param('id') id: string, @Body() data: any) {
    return this.absensiService.updateProgram(id, data, req.user);
  }

  @Delete('programs/all')
  @UseGuards(AccessControlGuard)
  deleteAllPrograms(@Request() req: any) {
    return this.absensiService.deleteAllPrograms(req.user);
  }

  @Delete('programs/:id')
  @UseGuards(AccessControlGuard)
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
    if (req?.user?.scope === 'CABANG') {
      effectiveWilayahId = req.user.wilayahId;
      effectiveCabangId = req.user.cabangId;
    } else if (req?.user?.scope === 'WILAYAH') {
      effectiveWilayahId = req.user.wilayahId;
    }
    return this.absensiService.getKehadiran(programId, kelasId, effectiveCabangId, effectiveWilayahId);
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
    const cabangId = body.cabangId || req.user?.cabangId;
    return this.absensiService.saveKehadiranBulk(body.programId, cabangId, body.logs);
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
    if (req?.user?.scope === 'CABANG') {
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
    const cabangId = body.cabangId || req.user?.cabangId;
    return this.absensiService.saveKehadiranGuruBulk(body.programId, cabangId, body.logs);
  }
}
