import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../../common/prisma/prisma.module.js';
import { KegiatanService } from './kegiatan.service.js';
import { KegiatanController } from './kegiatan.controller.js';

@Module({
  imports: [
    PrismaModule,
    ScheduleModule.forRoot()
  ],
  controllers: [KegiatanController],
  providers: [KegiatanService],
  exports: [KegiatanService]
})
export class KegiatanModule {}
