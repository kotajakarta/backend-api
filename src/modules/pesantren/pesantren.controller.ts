import { Controller, Get, Post, Put, Delete, UseGuards, Inject, Body, Param } from '@nestjs/common';
import { PesantrenService } from './pesantren.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';
import { RequireDivisi } from '../../common/decorators/access-control.decorator.js';

@Controller('pesantren')
@UseGuards(AccessControlGuard)
@RequireDivisi('PESANTREN')
export class PesantrenController {
  constructor(@Inject(PesantrenService) private readonly pesantrenService: PesantrenService) {}

  @Get('grup-daimi')
  getGrupDaimi() {
    return this.pesantrenService.getGrupDaimi();
  }

  @Post('grup-daimi')
  createGrupDaimi(@Body() data: { name: string }) {
    return this.pesantrenService.createGrupDaimi(data);
  }

  @Put('grup-daimi/:id')
  updateGrupDaimi(@Param('id') id: string, @Body() data: { name: string }) {
    return this.pesantrenService.updateGrupDaimi(id, data);
  }

  @Delete('grup-daimi/:id')
  deleteGrupDaimi(@Param('id') id: string) {
    return this.pesantrenService.deleteGrupDaimi(id);
  }
}
