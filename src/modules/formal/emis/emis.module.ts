import { Module } from '@nestjs/common';
import { EmisController } from './emis.controller.js';
import { EmisService } from './emis.service.js';
import { EmisCryptoService } from './emis-crypto.service.js';
import { VervalService } from './verval.service.js';

@Module({
  controllers: [EmisController],
  providers: [EmisService, EmisCryptoService, VervalService],
  exports: [EmisService, EmisCryptoService, VervalService],
})
export class EmisModule {}
