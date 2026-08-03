import { Controller, Get, Post, Body, Param, UseGuards, Request, Inject } from '@nestjs/common';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';
import { RequireScope } from '../../common/decorators/access-control.decorator.js';
import { PortalService } from './portal.service.js';
import { ApprovePermohonanIzinDto, RejectPermohonanIzinDto } from './dto/approve-reject-permohonan-izin.dto.js';

// Staff-facing izin approval. @RequireScope('CABANG') also passes GLOBAL/WILAYAH through
// (per the guard's existing hierarchy — CABANG is the lowest staff tier and the guard's
// CABANG branch imposes no additional restriction), matching the approver tier used by
// other staff-approval endpoints in this codebase (there are no individual teacher/ustadz
// logins — only office-level GLOBAL/WILAYAH/CABANG accounts).
@Controller('permohonan-izin-santri')
@UseGuards(AccessControlGuard)
@RequireScope('CABANG')
export class PermohonanIzinAdminController {
  constructor(@Inject(PortalService) private readonly portalService: PortalService) {}

  @Get()
  list(@Request() req: any) {
    return this.portalService.listPermohonanIzinStaff(req.user);
  }

  @Post(':id/approve')
  approve(@Request() req: any, @Param('id') id: string, @Body() dto: ApprovePermohonanIzinDto) {
    return this.portalService.approvePermohonanIzin(id, req.user, dto.catatanAdmin);
  }

  @Post(':id/reject')
  reject(@Request() req: any, @Param('id') id: string, @Body() dto: RejectPermohonanIzinDto) {
    return this.portalService.rejectPermohonanIzin(id, req.user, dto.catatanAdmin);
  }
}
