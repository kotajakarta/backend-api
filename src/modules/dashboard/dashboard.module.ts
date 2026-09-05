import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';
import { DashboardRekapService } from './dashboard-rekap.service.js';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, DashboardRekapService],
  exports: [DashboardService, DashboardRekapService]
})
export class DashboardModule {}

