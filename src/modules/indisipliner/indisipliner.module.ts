import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module.js';
import { MinioModule } from '../../common/minio/minio.module.js';
import { IndisiplinerController } from './indisipliner.controller.js';
import { IndisiplinerService } from './indisipliner.service.js';
import { IndisiplinerTemplateService } from './indisipliner-template.service.js';

@Module({
  imports: [PrismaModule, MinioModule],
  controllers: [IndisiplinerController],
  providers: [IndisiplinerService, IndisiplinerTemplateService],
  exports: [IndisiplinerService, IndisiplinerTemplateService],
})
export class IndisiplinerModule {}
