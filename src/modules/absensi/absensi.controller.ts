import { Controller, Post, Body, UseGuards, Inject } from '@nestjs/common';
import { AbsensiService } from './absensi.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';

@Controller('absensi')
export class AbsensiController {
  constructor(@Inject(AbsensiService) private readonly absensiService: AbsensiService) {}

  @Post('log')
  @UseGuards(AccessControlGuard)
  logKehadiran(@Body() body: { logs: { studentId: string; status: string }[] }) {
    return this.absensiService.logKehadiran(body.logs);
  }
}
