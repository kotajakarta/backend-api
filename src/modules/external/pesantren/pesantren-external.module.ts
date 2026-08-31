import { Module } from '@nestjs/common';
import { PesantrenExternalController } from './pesantren-external.controller.js';
import { PesantrenExternalService } from './pesantren-external.service.js';
import { PrismaModule } from '../../../common/prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [PesantrenExternalController],
  providers: [PesantrenExternalService],
  exports: [PesantrenExternalService],
})
export class PesantrenExternalModule {}
