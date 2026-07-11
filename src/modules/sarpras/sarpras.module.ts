import { Module } from '@nestjs/common';
import { SarprasController } from './sarpras.controller.js';
import { SarprasService } from './sarpras.service.js';

@Module({
  controllers: [SarprasController],
  providers: [SarprasService],
})
export class SarprasModule {}
