import { Controller, Get, Query, UseGuards, Request, Inject } from '@nestjs/common';
import { AuditLogService } from './audit-log.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';

@Controller('audit-logs')
export class AuditLogController {
  constructor(@Inject(AuditLogService) private readonly auditLogService: AuditLogService) {}

  @Get()
  @UseGuards(AccessControlGuard)
  async getLogs(
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const p = page ? parseInt(page, 10) : 1;
    const l = limit ? parseInt(limit, 10) : 10;
    return this.auditLogService.getLogs(req.user, p, l);
  }
}
