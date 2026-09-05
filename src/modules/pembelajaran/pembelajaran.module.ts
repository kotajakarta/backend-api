import { Module } from '@nestjs/common';
import { PembelajaranController } from './pembelajaran.controller.js';
import { PembelajaranService } from './pembelajaran.service.js';
import { PembelajaranRekapService } from './pembelajaran-rekap.service.js';

@Module({
  controllers: [PembelajaranController],
  providers: [PembelajaranService, PembelajaranRekapService],
  exports: [PembelajaranService, PembelajaranRekapService]
})
export class PembelajaranModule {}
