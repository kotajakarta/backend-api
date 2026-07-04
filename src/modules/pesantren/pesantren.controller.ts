import { Controller, Get, UseGuards, Inject } from '@nestjs/common';
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
}
