import { IsString, IsNotEmpty, IsEnum, IsDateString } from 'class-validator';
import { JenisIzinSantri } from '@prisma/client';

export class CreatePermohonanIzinDto {
  @IsString()
  @IsNotEmpty()
  studentId!: string;

  @IsEnum(JenisIzinSantri)
  @IsNotEmpty()
  jenisIzin!: JenisIzinSantri;

  @IsString()
  @IsNotEmpty()
  keterangan!: string;

  @IsDateString()
  @IsNotEmpty()
  tanggalMulai!: string;

  @IsDateString()
  @IsNotEmpty()
  tanggalSelesai!: string;
}
