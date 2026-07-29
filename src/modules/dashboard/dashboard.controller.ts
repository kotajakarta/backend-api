import { Controller, Get, UseGuards, Inject, Request, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';

@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboardService: DashboardService) {}

  @Get('stats')
  @UseGuards(AccessControlGuard)
  getStats(@Request() req: any, @Query() query: any) {
    return this.dashboardService.getStats(req.user, query);
  }

  @Get('ketersediaan-guru')
  @UseGuards(AccessControlGuard)
  getKetersediaanGuruDetail(@Request() req: any) {
    return this.dashboardService.getKetersediaanGuruDetail(req.user);
  }
}
