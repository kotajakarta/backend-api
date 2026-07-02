import { Module } from '@nestjs/common';
import { PrismaModule } from './common/prisma/prisma.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { StudentModule } from './modules/core/student/student.module.js';
import { MasterDataModule } from './modules/core/master/master-data.module.js';
import { AbsensiModule } from './modules/absensi/absensi.module.js';
import { FormalModule } from './modules/formal/formal.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { PesantrenModule } from './modules/pesantren/pesantren.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    StudentModule,
    MasterDataModule,
    AbsensiModule,
    FormalModule,
    AdminModule,
    DashboardModule,
    PesantrenModule,
    HealthModule
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
