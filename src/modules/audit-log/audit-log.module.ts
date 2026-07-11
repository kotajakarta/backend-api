import { Module, Global } from '@nestjs/common';
import { AuditLogService } from './audit-log.service.js';
import { AuditLogController } from './audit-log.controller.js';
import { PrismaModule } from '../../common/prisma/prisma.module.js';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [AuditLogController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
