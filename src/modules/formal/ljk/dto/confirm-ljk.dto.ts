import { IsString, IsNotEmpty, IsObject, IsOptional, IsNumber } from 'class-validator';

export class ConfirmLjkDto {
  @IsString()
  @IsNotEmpty()
  kodeCabang!: string;

  @IsString()
  @IsNotEmpty()
  mapel!: string;

  @IsString()
  @IsNotEmpty()
  semester!: string;

  @IsString()
  @IsNotEmpty()
  kelas!: string;

  @IsString()
  @IsNotEmpty()
  nisn!: string;

  @IsObject()
  @IsNotEmpty()
  jawaban!: Record<string, string>;

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
  fileUrl?: string;

  @IsOptional()
  @IsNumber()
  confidence?: number;

  @IsOptional()
  @IsString()
  questionBankId?: string;

  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsString()
  cabangId?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
