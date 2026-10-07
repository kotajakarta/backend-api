import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module.js';
import { MinioModule } from '../../common/minio/minio.module.js';
import { PemesananBukuController } from './pemesanan-buku.controller.js';
import { PemesananBukuService } from './pemesanan-buku.service.js';
import { PemesananBukuSesiService } from './pemesanan-buku-sesi.service.js';
import { PemesananBukuPdfService } from './pemesanan-buku-pdf.service.js';
import { PemesananBukuTtdStorage } from './pemesanan-buku-ttd.storage.js';

@Module({
  imports: [PrismaModule, MinioModule],
  controllers: [PemesananBukuController],
  providers: [PemesananBukuService, PemesananBukuSesiService, PemesananBukuPdfService, PemesananBukuTtdStorage],
})
export class PemesananBukuModule {}
