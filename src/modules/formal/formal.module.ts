import { Module } from '@nestjs/common';
import { FormalController } from './formal.controller.js';
import { FormalService } from './formal.service.js';
import { EmisModule } from './emis/emis.module.js';
import { MasterDataModule } from '../core/master/master-data.module.js';
import { LjkModule } from './ljk/ljk.module.js';

@Module({
  imports: [EmisModule, MasterDataModule, LjkModule],
  controllers: [FormalController],
  providers: [FormalService],
  exports: [FormalService, LjkModule],
})
export class FormalModule {}
