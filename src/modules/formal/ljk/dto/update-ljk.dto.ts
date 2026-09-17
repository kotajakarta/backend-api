import { IsString, IsObject, IsOptional, IsNumber } from 'class-validator';

export class UpdateLjkDto {
  @IsOptional()
  @IsString()
  kodeCabang?: string;

  @IsOptional()
  @IsString()
  mapel?: string;

  @IsOptional()
  @IsString()
  semester?: string;

  @IsOptional()
  @IsString()
  kelas?: string;

  @IsOptional()
  @IsString()
  nisn?: string;

  @IsOptional()
  @IsObject()
  jawaban?: Record<string, string>;

  @IsOptional()
  @IsNumber()
  totalSoal?: number;

  @IsOptional()
  @IsNumber()
  jumlahBenar?: number;

  @IsOptional()
  @IsNumber()
  jumlahSalah?: number;

  @IsOptional()
  @IsNumber()
  jumlahKosong?: number;

  @IsOptional()
  @IsNumber()
  skor?: number;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  questionBankId?: string;

  @IsOptional()
  @IsString()
  studentId?: string;
}
