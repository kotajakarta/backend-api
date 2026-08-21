import { Module } from '@nestjs/common';
import { PortalController } from './portal.controller.js';
import { PermohonanIzinAdminController } from './permohonan-izin-admin.controller.js';
import { PengumumanWalsanAdminController } from './pengumuman-walsan-admin.controller.js';
import { CctvController } from './cctv.controller.js';
import { CctvProxyController } from './cctv-proxy.controller.js';
import { SyahriyahAdminController } from './syahriyah-admin.controller.js';
import { SyahriyahPortalController } from './syahriyah-portal.controller.js';
import { PortalService } from './portal.service.js';
import { SyahriyahService } from './syahriyah.service.js';
import { FormalModule } from '../formal/formal.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PengaturanModule } from '../core/pengaturan/pengaturan.module.js';

@Module({
  imports: [FormalModule, AuthModule, PengaturanModule],
  controllers: [
    PortalController,
    PermohonanIzinAdminController,
    PengumumanWalsanAdminController,
    CctvController,
    CctvProxyController,
    SyahriyahAdminController,
    SyahriyahPortalController
  ],
  providers: [PortalService, SyahriyahService],
  exports: [SyahriyahService]
})
export class PortalModule {}
