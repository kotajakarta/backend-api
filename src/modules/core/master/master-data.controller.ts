import { Controller, Get, Post, Put, Delete, UseGuards, Request, Inject } from '@nestjs/common';
import { MasterDataService } from './master-data.service.js';
import { AccessControlGuard } from '../../../common/guards/access-control.guard.js';

@Controller('master-data')
export class MasterDataController {
  constructor(@Inject(MasterDataService) private readonly masterDataService: MasterDataService) {}

  @Get('guru')
  @UseGuards(AccessControlGuard)
  getGuru(@Request() req: any) {
    return this.masterDataService.getGuru(req.user);
  }

  @Post('guru/import')
  @UseGuards(AccessControlGuard)
  importGuru(@Request() req: any) {
    return this.masterDataService.importGuru(req.user, req.body);
  }

  @Post('cabang/import')
  @UseGuards(AccessControlGuard)
  importCabang(@Request() req: any) {
    return this.masterDataService.importCabang(req.user, req.body);
  }

  @Post('wilayah/import')
  @UseGuards(AccessControlGuard)
  importWilayah(@Request() req: any) {
    return this.masterDataService.importWilayah(req.user, req.body);
  }

  @Post('guru')
  @UseGuards(AccessControlGuard)
  createGuru(@Request() req: any) {
    return this.masterDataService.createGuru(req.body);
  }

  @Put('guru/:id')
  @UseGuards(AccessControlGuard)
  updateGuru(@Request() req: any) {
    return this.masterDataService.updateGuru(req.params.id, req.body);
  }

  @Delete('guru/all')
  @UseGuards(AccessControlGuard)
  deleteAllGuru(@Request() req: any) {
    return this.masterDataService.deleteAllGuru(req.user);
  }

  @Delete('guru/:id')
  @UseGuards(AccessControlGuard)
  deleteGuru(@Request() req: any) {
    return this.masterDataService.deleteGuru(req.params.id);
  }

  @Get('pool-guru')
  @UseGuards(AccessControlGuard)
  getPoolGuru(@Request() req: any) {
    return this.masterDataService.getPoolGuru(req.user);
  }

  @Delete('pool-guru/all')
  @UseGuards(AccessControlGuard)
  deletePoolGuru(@Request() req: any) {
    return this.masterDataService.deletePoolGuru(req.user);
  }

  @Post('pool-guru/tarik-massal')
  @UseGuards(AccessControlGuard)
  tarikMassalGuru(@Request() req: any) {
    return this.masterDataService.tarikMassalGuru(req.body.staffIds, req.body.cabangId);
  }

  @Post('pool-guru/:id/lepas')
  @UseGuards(AccessControlGuard)
  lepasGuru(@Request() req: any) {
    return this.masterDataService.lepasGuru(req.params.id);
  }

  @Get('cabang')
  @UseGuards(AccessControlGuard)
  getCabang(@Request() req: any) {
    return this.masterDataService.getCabang(req.user);
  }

  @Post('cabang')
  @UseGuards(AccessControlGuard)
  createCabang(@Request() req: any) {
    return this.masterDataService.createCabang(req.body);
  }

  @Put('cabang/:id')
  @UseGuards(AccessControlGuard)
  updateCabang(@Request() req: any) {
    return this.masterDataService.updateCabang(req.params.id, req.body);
  }

  @Delete('cabang/all')
  @UseGuards(AccessControlGuard)
  deleteAllCabang(@Request() req: any) {
    return this.masterDataService.deleteAllCabang(req.user);
  }

  @Delete('cabang/:id')
  @UseGuards(AccessControlGuard)
  deleteCabang(@Request() req: any) {
    return this.masterDataService.deleteCabang(req.params.id);
  }

  @Get('wilayah')
  @UseGuards(AccessControlGuard)
  getWilayah() {
    return this.masterDataService.getWilayah();
  }

  @Post('wilayah')
  @UseGuards(AccessControlGuard)
  createWilayah(@Request() req: any) {
    return this.masterDataService.createWilayah(req.body);
  }

  @Put('wilayah/:id')
  @UseGuards(AccessControlGuard)
  updateWilayah(@Request() req: any) {
    return this.masterDataService.updateWilayah(req.params.id, req.body);
  }

  @Delete('wilayah/all')
  @UseGuards(AccessControlGuard)
  deleteAllWilayah(@Request() req: any) {
    return this.masterDataService.deleteAllWilayah(req.user);
  }

  @Delete('wilayah/:id')
  @UseGuards(AccessControlGuard)
  deleteWilayah(@Request() req: any) {
    return this.masterDataService.deleteWilayah(req.params.id);
  }
}
