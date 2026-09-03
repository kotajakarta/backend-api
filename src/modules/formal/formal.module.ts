import { Module } from '@nestjs/common';
import { FormalController } from './formal.controller.js';
import { FormalService } from './formal.service.js';
import { EmisModule } from './emis/emis.module.js';

@Module({
  imports: [EmisModule],
  controllers: [FormalController],
  providers: [FormalService],
  exports: [FormalService],
})
export class FormalModule {}
