import { Module } from '@nestjs/common';
import { PembelajaranController } from './pembelajaran.controller.js';
import { PembelajaranService } from './pembelajaran.service.js';

@Module({
  controllers: [PembelajaranController],
  providers: [PembelajaranService],
  exports: [PembelajaranService]
})
export class PembelajaranModule {}
