import { Controller, Get, UseGuards, Inject, Request } from '@nestjs/common';
import { DashboardService } from './dashboard.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';

@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboardService: DashboardService) {}

  @Get('stats')
  @UseGuards(AccessControlGuard)
  getStats(@Request() req: any) {
    return this.dashboardService.getStats(req.user);
  }
}
