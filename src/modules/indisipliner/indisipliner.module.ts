import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module.js';
import { IndisiplinerController } from './indisipliner.controller.js';
import { IndisiplinerService } from './indisipliner.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [IndisiplinerController],
  providers: [IndisiplinerService],
  exports: [IndisiplinerService],
})
export class IndisiplinerModule {}
