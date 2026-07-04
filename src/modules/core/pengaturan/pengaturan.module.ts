import { Module } from '@nestjs/common';
import { PengaturanController } from './pengaturan.controller.js';
import { PengaturanService } from './pengaturan.service.js';

@Module({
  controllers: [PengaturanController],
  providers: [PengaturanService],
})
export class PengaturanModule {}
