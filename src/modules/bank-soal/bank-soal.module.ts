import { Module } from '@nestjs/common';
import { BankSoalController } from './bank-soal.controller.js';
import { BankSoalService } from './services/bank-soal.service.js';
import { DocxExportService } from './services/docx-export.service.js';
import { PrismaModule } from '../../common/prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [BankSoalController],
  providers: [BankSoalService, DocxExportService],
  exports: [BankSoalService, DocxExportService],
})
export class BankSoalModule {}
