import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  UseGuards,
  Inject,
  ForbiddenException,
  Request,
} from '@nestjs/common';
import { PpdbService } from './ppdb.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';

@Controller('ppdb')
export class PpdbController {
  constructor(@Inject(PpdbService) private readonly ppdbService: PpdbService) {}

  /**
   * Public endpoint to fetch PPDB landing page information.
   * No authentication required.
   */
  @Get('public')
  async getPublicPpdb() {
    const data = await this.ppdbService.getPublicSettings();
    return {
      success: true,
      data,
    };
  }

  /**
   * Admin endpoint to get PPDB configuration.
   * Requires Admin / GLOBAL scope.
   */
  @Get('admin')
  @UseGuards(AccessControlGuard)
  async getAdminPpdb(@Request() req: any) {
    if (req.user?.scope !== 'GLOBAL' && req.user?.role !== 'ADMIN') {
      throw new ForbiddenException('Akses ditolak: Hanya Admin GLOBAL yang dapat mengelola PPDB');
    }
    const data = await this.ppdbService.getAdminSettings();
    return {
      success: true,
      data,
    };
  }

  /**
   * Admin endpoint to update PPDB configuration.
   */
  @Put('admin')
  @UseGuards(AccessControlGuard)
  async updatePpdb(@Body() body: any, @Request() req: any) {
    if (req.user?.scope !== 'GLOBAL' && req.user?.role !== 'ADMIN') {
      throw new ForbiddenException('Akses ditolak: Hanya Admin GLOBAL yang dapat mengubah PPDB');
    }
    const data = await this.ppdbService.updateSettings(body);
    return {
      success: true,
      message: 'Pengaturan PPDB berhasil diperbarui',
      data,
    };
  }

  /**
   * Admin endpoint to reset PPDB configuration to default template.
   */
  @Post('admin/reset')
  @UseGuards(AccessControlGuard)
  async resetPpdb(@Request() req: any) {
    if (req.user?.scope !== 'GLOBAL' && req.user?.role !== 'ADMIN') {
      throw new ForbiddenException('Akses ditolak: Hanya Admin GLOBAL yang dapat mereset PPDB');
    }
    const data = await this.ppdbService.resetToDefault();
    return {
      success: true,
      message: 'Pengaturan PPDB berhasil direset ke template standar',
      data,
    };
  }
}
