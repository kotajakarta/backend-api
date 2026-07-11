import { Controller, Get, Post, Put, Delete, UseGuards, Inject, Body, Param } from '@nestjs/common';
import { PesantrenService } from './pesantren.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';

@Controller('pesantren')
export class PesantrenController {
  constructor(@Inject(PesantrenService) private readonly pesantrenService: PesantrenService) {}

  @Get('grup-daimi')
  @UseGuards(AccessControlGuard)
  getGrupDaimi() {
    return this.pesantrenService.getGrupDaimi();
  }

  @Post('grup-daimi')
  @UseGuards(AccessControlGuard)
  createGrupDaimi(@Body() data: { name: string }) {
    return this.pesantrenService.createGrupDaimi(data);
  }

  @Put('grup-daimi/:id')
  @UseGuards(AccessControlGuard)
  updateGrupDaimi(@Param('id') id: string, @Body() data: { name: string }) {
    return this.pesantrenService.updateGrupDaimi(id, data);
  }

  @Delete('grup-daimi/:id')
  @UseGuards(AccessControlGuard)
  deleteGrupDaimi(@Param('id') id: string) {
    return this.pesantrenService.deleteGrupDaimi(id);
  }
}
