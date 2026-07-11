import { Controller, Get, Post, Put, Delete, UseGuards, Request, Inject } from '@nestjs/common';
import { SarprasService } from './sarpras.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';

@Controller('sarpras')
export class SarprasController {
  constructor(@Inject(SarprasService) private readonly sarprasService: SarprasService) {}

  // === RUANG ===
  @Get('ruang')
  @UseGuards(AccessControlGuard)
  getRuang(@Request() req: any) {
    return this.sarprasService.getRuang(req.user);
  }

  @Get('ruang/:id')
  @UseGuards(AccessControlGuard)
  getRuangById(@Request() req: any) {
    return this.sarprasService.getRuangById(req.params.id, req.user);
  }

  @Post('ruang')
  @UseGuards(AccessControlGuard)
  createRuang(@Request() req: any) {
    return this.sarprasService.createRuang(req.body, req.user);
  }

  @Put('ruang/:id')
  @UseGuards(AccessControlGuard)
  updateRuang(@Request() req: any) {
    return this.sarprasService.updateRuang(req.params.id, req.body, req.user);
  }

  @Delete('ruang/:id')
  @UseGuards(AccessControlGuard)
  deleteRuang(@Request() req: any) {
    return this.sarprasService.deleteRuang(req.params.id, req.user);
  }

  // === FASILITAS ===
  @Get('fasilitas')
  @UseGuards(AccessControlGuard)
  getFasilitas(@Request() req: any) {
    return this.sarprasService.getFasilitas(req.user);
  }

  @Get('fasilitas/:id')
  @UseGuards(AccessControlGuard)
  getFasilitasById(@Request() req: any) {
    return this.sarprasService.getFasilitasById(req.params.id, req.user);
  }

  @Post('fasilitas')
  @UseGuards(AccessControlGuard)
  createFasilitas(@Request() req: any) {
    return this.sarprasService.createFasilitas(req.body, req.user);
  }

  @Put('fasilitas/:id')
  @UseGuards(AccessControlGuard)
  updateFasilitas(@Request() req: any) {
    return this.sarprasService.updateFasilitas(req.params.id, req.body, req.user);
  }

  @Delete('fasilitas/:id')
  @UseGuards(AccessControlGuard)
  deleteFasilitas(@Request() req: any) {
    return this.sarprasService.deleteFasilitas(req.params.id, req.user);
  }
}
