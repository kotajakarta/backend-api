import { IsString, IsNotEmpty, IsDateString, IsOptional, IsEnum } from 'class-validator';
import { KegiatanStatus } from '@prisma/client';

export class CreateKegiatanDto {
  @IsString()
  @IsNotEmpty()
  judul!: string;

  @IsString()
  @IsNotEmpty()
  deskripsi!: string;

  @IsString()
  @IsNotEmpty()
  ringkasan!: string;

  @IsString()
  @IsNotEmpty()
  jenis!: string;

  @IsDateString()
  @IsNotEmpty()
  deadline!: string;

  @IsString()
  @IsNotEmpty()
  ketuaPanitiaId!: string;

  @IsString()
  @IsOptional()
  asramaId?: string;

  @IsString()
  @IsOptional()
  cabangId?: string;
}

export class UpdateKegiatanDto {
  @IsString()
  @IsOptional()
  judul?: string;

  @IsString()
  @IsOptional()
  deskripsi?: string;

  @IsString()
  @IsOptional()
  ringkasan?: string;

  @IsString()
  @IsOptional()
  jenis?: string;

  @IsDateString()
  @IsOptional()
  deadline?: string;

  @IsEnum(KegiatanStatus)
  @IsOptional()
  status?: KegiatanStatus;

  @IsString()
  @IsOptional()
  ketuaPanitiaId?: string;

  @IsString()
  @IsOptional()
  asramaId?: string;

  @IsString()
  @IsOptional()
  cabangId?: string;
}
