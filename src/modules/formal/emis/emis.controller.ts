import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Req,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ValidationPipe,
  Inject,
} from '@nestjs/common';
import { AccessControlGuard } from '../../../common/guards/access-control.guard.js';
import { RequireScope } from '../../../common/decorators/access-control.decorator.js';
import { EmisService } from './emis.service.js';
import { VervalService } from './verval.service.js';

import { IsString, IsNotEmpty, IsArray, IsOptional, IsNumber, IsBoolean } from 'class-validator';

class FetchEmisListDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}

class FetchEmisDetailsDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsArray()
  studentIds!: string[];

  @IsOptional()
  @IsNumber()
  delayMs?: number;
}

class FetchVervalDto {
  @IsString()
  @IsNotEmpty()
  cookie!: string;

  @IsOptional()
  @IsNumber()
  limit?: number;
}

class ReconcileDto {
  @IsOptional()
  @IsArray()
  emisStudents?: any[];

  @IsOptional()
  @IsArray()
  vervalStudents?: any[];

  @IsOptional()
  @IsString()
  cabangId?: string;

  @IsOptional()
  @IsString()
  wilayahId?: string;

  @IsOptional()
  @IsBoolean()
  resetEmis?: boolean;

  @IsOptional()
  @IsBoolean()
  resetVerval?: boolean;
}

/**
/**
 * Controller untuk integrasi, audit, dan validasi EMIS & Verval.
 * Endpoint write/sinkronisasi terproteksi @RequireScope('GLOBAL').
 * Endpoint baca hasil komparasi terproteksi @RequireScope('CABANG') dengan scoping otomatis sesuai cabang pengguna.
 */
@Controller('formal/emis')
@UseGuards(AccessControlGuard)
export class EmisController {
  constructor(
    @Inject(EmisService) private readonly emisService: EmisService,
    @Inject(VervalService) private readonly vervalService: VervalService,
  ) {}

  /**
   * Mengambil list santri ringkas dari API EMIS
   */
  @Post('fetch-list')
  @RequireScope('GLOBAL')
  @HttpCode(HttpStatus.OK)
  async fetchEmisList(@Body() dto: FetchEmisListDto) {
    const students = await this.emisService.fetchStudentList(dto.token);
    return {
      success: true,
      total: students.length,
      data: students,
    };
  }

  /**
   * Mengambil detail santri EMIS lengkap dengan enkripsi AES-256-CBC
   */
  @Post('fetch-details')
  @RequireScope('GLOBAL')
  @HttpCode(HttpStatus.OK)
  async fetchEmisDetails(@Body() dto: FetchEmisDetailsDto) {
    const details = await this.emisService.fetchStudentDetails(
      dto.token,
      dto.studentIds,
      dto.delayMs || 250,
    );
    return {
      success: true,
      total: details.length,
      data: details,
    };
  }

  /**
   * Mengambil data siswa dari VervalPD Kemendikbud
   */
  @Post('verval/fetch-daftar')
  @RequireScope('GLOBAL')
  @HttpCode(HttpStatus.OK)
  async fetchVervalDaftar(@Body() dto: FetchVervalDto) {
    const students = await this.vervalService.fetchDaftarSiswa(dto.cookie, dto.limit || 8000);
    return {
      success: true,
      total: students.length,
      data: students,
    };
  }

  /**
   * Mengambil data residu siswa dari VervalPD Kemendikbud
   */
  @Post('verval/fetch-residu')
  @RequireScope('GLOBAL')
  @HttpCode(HttpStatus.OK)
  async fetchVervalResidu(@Body() dto: FetchVervalDto) {
    const residu = await this.vervalService.fetchResiduSiswa(dto.cookie, dto.limit || 1000);
    return {
      success: true,
      total: residu.length,
      data: residu,
    };
  }

  /**
   * REKONSILIASI & VALIDASI:
   * Membandingkan data EMIS / Verval dengan database PostgreSQL eSantri.
   * Murni READ-ONLY untuk data santri eSantri, dan otomatis menyimpan snapshot audit ke database (tabel formal.komparasi_emis).
   */
  @Post('reconcile')
  @RequireScope('GLOBAL')
  @HttpCode(HttpStatus.OK)
  async reconcileData(@Body() dto: ReconcileDto, @Req() req: any) {
    const result = await this.emisService.reconcileWithDatabase({
      emisStudents: dto.emisStudents || [],
      vervalStudents: dto.vervalStudents || [],
      cabangId: dto.cabangId,
      wilayahId: dto.wilayahId,
      resetEmis: dto.resetEmis,
      resetVerval: dto.resetVerval,
      executedById: req?.user?.id,
    });
    return {
      success: true,
      data: result,
    };
  }

  /**
   * Mengambil hasil audit & komparasi paling akhir yang tersimpan di database.
   * Scoped: Jika user adalah role CABANG, otomatis hanya menampilkan santri cabangnya.
   */
  @Get('latest')
  @RequireScope('CABANG')
  async getLatestReconcile(
    @Req() req: any,
    @Query('cabangId') queryCabangId?: string,
    @Query('wilayahId') queryWilayahId?: string,
  ) {
    let effectiveCabangId = queryCabangId;
    let effectiveWilayahId = queryWilayahId;

    if (req.user?.scope === 'CABANG') {
      effectiveCabangId = req.user.cabangId;
      effectiveWilayahId = undefined;
    } else if (req.user?.scope === 'WILAYAH') {
      if (!effectiveCabangId) {
        effectiveWilayahId = req.user.wilayahId;
      }
    }

    const result = await this.emisService.getLatestReconcile(effectiveCabangId, effectiveWilayahId);
    return {
      success: true,
      data: result,
    };
  }

  /**
   * Mengambil daftar riwayat sesi/batch audit komparasi lampau
   */
  @Get('history')
  @RequireScope('CABANG')
  async getReconcileHistory(@Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 15;
    const history = await this.emisService.getReconcileHistory(limitNum);
    return {
      success: true,
      data: history,
    };
  }

  /**
   * Mengambil detail komparasi dari batch ID tertentu
   */
  @Get('history/:batchId')
  @RequireScope('CABANG')
  async getReconcileBatchDetail(
    @Req() req: any,
    @Param('batchId') batchId: string,
    @Query('cabangId') queryCabangId?: string,
    @Query('wilayahId') queryWilayahId?: string,
  ) {
    let effectiveCabangId = queryCabangId;
    let effectiveWilayahId = queryWilayahId;

    if (req.user?.scope === 'CABANG') {
      effectiveCabangId = req.user.cabangId;
      effectiveWilayahId = undefined;
    } else if (req.user?.scope === 'WILAYAH') {
      if (!effectiveCabangId) {
        effectiveWilayahId = req.user.wilayahId;
      }
    }

    const result = await this.emisService.getReconcileBatchDetail(batchId, effectiveCabangId, effectiveWilayahId);
    return {
      success: true,
      data: result,
    };
  }
}
