import { Module } from '@nestjs/common';
import { PesantrenController } from './pesantren.controller.js';
import { PesantrenService } from './pesantren.service.js';

@Module({
  imports: [],
  controllers: [PesantrenController],
  providers: [PesantrenService],
})
export class PesantrenModule {}
