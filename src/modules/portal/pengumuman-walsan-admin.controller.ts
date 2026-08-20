import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, Inject } from '@nestjs/common';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';
import { RequireScope } from '../../common/decorators/access-control.decorator.js';
import { PortalService } from './portal.service.js';

@Controller('admin/pengumuman-walsan')
@UseGuards(AccessControlGuard)
@RequireScope('CABANG')
export class PengumumanWalsanAdminController {
  constructor(@Inject(PortalService) private readonly portalService: PortalService) {}

  @Get()
  getPengumumanList(@Request() req: any) {
    return this.portalService.getPengumumanWalsanForAdmin(req.user);
  }

  @Post()
  createPengumuman(@Request() req: any, @Body() body: any) {
    return this.portalService.createPengumumanWalsan(req.user, body);
  }

  @Put(':id')
  updatePengumuman(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.portalService.updatePengumumanWalsan(req.user, id, body);
  }

  @Delete(':id')
  deletePengumuman(@Request() req: any, @Param('id') id: string) {
    return this.portalService.deletePengumumanWalsan(req.user, id);
  }
}
