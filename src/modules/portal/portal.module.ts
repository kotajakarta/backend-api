import { Module } from '@nestjs/common';
import { PortalController } from './portal.controller.js';
import { PermohonanIzinAdminController } from './permohonan-izin-admin.controller.js';
import { PengumumanWalsanAdminController } from './pengumuman-walsan-admin.controller.js';
import { CctvController } from './cctv.controller.js';
import { CctvProxyController } from './cctv-proxy.controller.js';
import { PortalService } from './portal.service.js';
import { FormalModule } from '../formal/formal.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [FormalModule, AuthModule],
  controllers: [PortalController, PermohonanIzinAdminController, PengumumanWalsanAdminController, CctvController, CctvProxyController],
  providers: [PortalService]
})
export class PortalModule {}
