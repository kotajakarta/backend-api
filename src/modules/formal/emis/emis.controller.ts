import {
  Controller,
  Post,
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

import { IsString, IsNotEmpty, IsArray, IsOptional, IsNumber } from 'class-validator';

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
}

/**
 * Controller khusus Admin Global (scope: GLOBAL) untuk audit dan validasi EMIS & Verval.
 * Seluruh endpoint terlindungi AccessControlGuard dan RequireScope('GLOBAL').
 */
@Controller('formal/emis')
@UseGuards(AccessControlGuard)
@RequireScope('GLOBAL')
export class EmisController {
  constructor(
    @Inject(EmisService) private readonly emisService: EmisService,
    @Inject(VervalService) private readonly vervalService: VervalService,
  ) {}

  /**
   * Mengambil list santri ringkas dari API EMIS
   */
  @Post('fetch-list')
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
   * Murni READ-ONLY untuk audit dan menghasilkan rekomendasi per cabang.
   */
  @Post('reconcile')
  @HttpCode(HttpStatus.OK)
  async reconcileData(@Body() dto: ReconcileDto) {
    const result = await this.emisService.reconcileWithDatabase({
      emisStudents: dto.emisStudents || [],
      vervalStudents: dto.vervalStudents || [],
      cabangId: dto.cabangId,
      wilayahId: dto.wilayahId,
    });
    return {
      success: true,
      data: result,
    };
  }
}
