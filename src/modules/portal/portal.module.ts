import { Module } from '@nestjs/common';
import { PortalController } from './portal.controller.js';
import { PermohonanIzinAdminController } from './permohonan-izin-admin.controller.js';
import { PortalService } from './portal.service.js';
import { FormalModule } from '../formal/formal.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [FormalModule, AuthModule],
  controllers: [PortalController, PermohonanIzinAdminController],
  providers: [PortalService]
})
export class PortalModule {}
