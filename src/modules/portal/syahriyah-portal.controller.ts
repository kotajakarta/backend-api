import { Controller, Get, Post, Body, Param, Query, UseGuards, Request, Inject } from '@nestjs/common';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';
import { RequireScope } from '../../common/decorators/access-control.decorator.js';
import { SyahriyahService } from './syahriyah.service.js';

@Controller('portal/students/:studentId/syahriyah')
@UseGuards(AccessControlGuard)
@RequireScope('WALI')
export class SyahriyahPortalController {
  constructor(@Inject(SyahriyahService) private readonly syahriyahService: SyahriyahService) {}

  @Get()
  getTagihan(
    @Request() req: any,
    @Param('studentId') studentId: string,
    @Query() query: any
  ) {
    return this.syahriyahService.getWaliTagihan(req.user.id, studentId, query);
  }

  @Get('rekening')
  getRekening(
    @Request() req: any,
    @Param('studentId') studentId: string
  ) {
    return this.syahriyahService.getWaliRekening(req.user.id, studentId);
  }

  @Post('bayar')
  submitBayar(
    @Request() req: any,
    @Param('studentId') studentId: string,
    @Body() body: any
  ) {
    return this.syahriyahService.submitWaliPembayaran(req.user.id, studentId, body);
  }
}
