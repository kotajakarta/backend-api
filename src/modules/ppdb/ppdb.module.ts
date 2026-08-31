import { Module } from '@nestjs/common';
import { PpdbController } from './ppdb.controller.js';
import { PpdbService } from './ppdb.service.js';
import { PrismaModule } from '../../common/prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [PpdbController],
  providers: [PpdbService],
  exports: [PpdbService],
})
export class PpdbModule {}
