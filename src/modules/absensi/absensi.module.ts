import { Module } from '@nestjs/common';
import { AbsensiController } from './absensi.controller.js';
import { AbsensiService } from './absensi.service.js';

@Module({
  controllers: [AbsensiController],
  providers: [AbsensiService],
  exports: [AbsensiService]
})
export class AbsensiModule {}
