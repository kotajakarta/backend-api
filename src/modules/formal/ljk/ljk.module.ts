import { Module } from '@nestjs/common';
import { LjkController } from './ljk.controller.js';
import { LjkService } from './ljk.service.js';
import { LjkOmrService } from './ljk-omr.service.js';

@Module({
  controllers: [LjkController],
  providers: [LjkService, LjkOmrService],
  exports: [LjkService, LjkOmrService],
})
export class LjkModule {}
