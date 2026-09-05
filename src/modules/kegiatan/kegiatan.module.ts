import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../../common/prisma/prisma.module.js';
import { KegiatanService } from './kegiatan.service.js';
import { KegiatanController } from './kegiatan.controller.js';
import { KegiatanRekapService } from './kegiatan-rekap.service.js';

@Module({
  imports: [
    PrismaModule
  ],
  controllers: [KegiatanController],
  providers: [KegiatanService, KegiatanRekapService],
  exports: [KegiatanService, KegiatanRekapService]
})
export class KegiatanModule {}
