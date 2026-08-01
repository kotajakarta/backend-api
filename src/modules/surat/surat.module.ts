import { Module } from '@nestjs/common';
import { SuratController } from './surat.controller.js';
import { SuratService } from './surat.service.js';

@Module({
  controllers: [SuratController],
  providers: [SuratService],
  exports: [SuratService],
})
export class SuratModule {}
