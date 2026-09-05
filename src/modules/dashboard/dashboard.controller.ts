import { Controller, Get, Post, UseGuards, Inject, Request, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';
import { RequireScope } from '../../common/decorators/access-control.decorator.js';

@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboardService: DashboardService) {}

  @Get('stats')
  @UseGuards(AccessControlGuard)
  getStats(@Request() req: any, @Query() query: any) {
    return this.dashboardService.getStats(req.user, query);
  }

  @Post('stats/sync')
  @UseGuards(AccessControlGuard)
  @RequireScope('GLOBAL')
  syncStats() {
    return this.dashboardService.syncRekap();
  }

  @Get('ketersediaan-guru')
  @UseGuards(AccessControlGuard)
  @RequireScope('WILAYAH')
  getKetersediaanGuruDetail(@Request() req: any) {
    return this.dashboardService.getKetersediaanGuruDetail(req.user);
  }
}

