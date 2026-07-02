import { Module } from '@nestjs/common';
import { FormalController } from './formal.controller.js';
import { FormalService } from './formal.service.js';

@Module({
  controllers: [FormalController],
  providers: [FormalService],
})
export class FormalModule {}
