import { IsString, IsOptional } from 'class-validator';

export class ScanLjkDto {
  @IsOptional()
  @IsString()
  mapel?: string;

  @IsOptional()
  @IsString()
  kelas?: string;

  @IsOptional()
  @IsString()
  semester?: string;

  @IsOptional()
  @IsString()
  questionBankId?: string;
}
