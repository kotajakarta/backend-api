import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, Request, Inject, BadRequestException } from '@nestjs/common';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';
import { RequireScope } from '../../common/decorators/access-control.decorator.js';
import { PortalService } from './portal.service.js';
import { CreatePermohonanIzinDto } from './dto/create-permohonan-izin.dto.js';

@Controller('portal')
@UseGuards(AccessControlGuard)
@RequireScope('WALI')
export class PortalController {
  constructor(@Inject(PortalService) private readonly portalService: PortalService) {}

  @Get('students')
  getStudents(@Request() req: any) {
    return this.portalService.getStudents(req.user.id);
  }

  @Get('students/:studentId')
  getStudentById(@Request() req: any, @Param('studentId') studentId: string) {
    return this.portalService.getStudentById(req.user.id, studentId);
  }

  @Get('students/:studentId/riwayat-kelas')
  getRiwayatKelas(@Request() req: any, @Param('studentId') studentId: string) {
    return this.portalService.getRiwayatKelas(req.user.id, studentId);
  }

  @Get('students/:studentId/rapor/riwayat')
  getRaporRiwayat(@Request() req: any, @Param('studentId') studentId: string) {
    return this.portalService.getRaporRiwayat(req.user.id, studentId);
  }

  @Get('students/:studentId/rapor/cetak')
  getRaporCetak(
    @Request() req: any,
    @Param('studentId') studentId: string,
    @Query('tahunAjaran') tahunAjaran: string,
    @Query('semester') semester: string
  ) {
    if (!tahunAjaran || !semester) {
      throw new BadRequestException('Parameter tahunAjaran dan semester wajib diisi');
    }
    return this.portalService.getRaporCetak(req.user.id, studentId, tahunAjaran, semester);
  }

  @Get('students/:studentId/hafalan')
  getHafalan(
    @Request() req: any,
    @Param('studentId') studentId: string,
    @Query('tahunAjaran') tahunAjaran: string,
    @Query('semester') semester: string
  ) {
    if (!tahunAjaran || !semester) {
      throw new BadRequestException('Parameter tahunAjaran dan semester wajib diisi');
    }
    return this.portalService.getHafalan(req.user.id, studentId, tahunAjaran, semester);
  }

  @Get('students/:studentId/kehadiran')
  getKehadiran(
    @Request() req: any,
    @Param('studentId') studentId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string
  ) {
    return this.portalService.getKehadiran(req.user.id, studentId, startDate, endDate);
  }

  @Get('pengumuman')
  getPengumuman(@Request() req: any, @Query('studentId') studentId?: string) {
    return this.portalService.getPengumuman(req.user.id, studentId);
  }

  @Put('students/:studentId/biodata')
  updateStudentBiodata(
    @Request() req: any,
    @Param('studentId') studentId: string,
    @Body() body: any,
  ) {
    return this.portalService.updateStudentBiodata(req.user.id, studentId, body);
  }

  @Get('permohonan-izin')
  getPermohonanIzinList(@Request() req: any, @Query('studentId') studentId?: string) {
    return this.portalService.getPermohonanIzinList(req.user.id, studentId);
  }

  @Post('permohonan-izin')
  createPermohonanIzin(@Request() req: any, @Body() dto: CreatePermohonanIzinDto) {
    return this.portalService.createPermohonanIzin(req.user.id, dto);
  }

  @Get('permohonan-izin/:id')
  getPermohonanIzinById(@Request() req: any, @Param('id') id: string) {
    return this.portalService.getPermohonanIzinById(req.user.id, id);
  }

  @Put('profile')
  updateProfile(@Request() req: any, @Body() body: any) {
    return this.portalService.updateProfile(req.user.id, body);
  }

  @Get('cctv/channels')
  getCctvChannels(@Request() req: any, @Query('studentId') studentId?: string) {
    return this.portalService.getCctvChannelsForWali(req.user.id, studentId);
  }
}
