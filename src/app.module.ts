import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './common/prisma/prisma.module.js';
import { RedisModule } from './common/redis/redis.module.js';
import { MinioModule } from './common/minio/minio.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { StudentModule } from './modules/core/student/student.module.js';
import { MasterDataModule } from './modules/core/master/master-data.module.js';
import { AbsensiModule } from './modules/absensi/absensi.module.js';
import { FormalModule } from './modules/formal/formal.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { PesantrenModule } from './modules/pesantren/pesantren.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { PengaturanModule } from './modules/core/pengaturan/pengaturan.module.js';
import { AuditLogModule } from './modules/audit-log/audit-log.module.js';
import { FaqModule } from './modules/faq/faq.module.js';
import { SearchModule } from './modules/search/search.module.js';
import { SarprasModule } from './modules/sarpras/sarpras.module.js';
import { KegiatanModule } from './modules/kegiatan/kegiatan.module.js';
import { PembelajaranModule } from './modules/pembelajaran/pembelajaran.module.js';
import { SuratModule } from './modules/surat/surat.module.js';
import { PortalModule } from './modules/portal/portal.module.js';
import { BankSoalModule } from './modules/bank-soal/bank-soal.module.js';
import { PpdbModule } from './modules/ppdb/ppdb.module.js';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    MinioModule,
    AuthModule,
    StudentModule,

    MasterDataModule,
    PengaturanModule,
    AbsensiModule,
    FormalModule,
    AdminModule,
    DashboardModule,
    PesantrenModule,
    HealthModule,
    AuditLogModule,
    FaqModule,
    SearchModule,
    SarprasModule,
    KegiatanModule,
    PembelajaranModule,
    SuratModule,
    PortalModule,
    BankSoalModule,
    PpdbModule,
    ScheduleModule.forRoot()
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
