import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateSesiDto {
  @IsString()
  @IsNotEmpty()
  tahunAjaran!: string;

  @IsString()
  @IsNotEmpty()
  semester!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isOpen?: boolean;
}

export class UpdateSesiDto {
  @IsOptional()
  @IsString()
  tahunAjaran?: string;

  @IsOptional()
  @IsString()
  semester?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isOpen?: boolean;
}

export class SesiBodyDto {
  @IsString()
  @IsNotEmpty()
  sesiId!: string;
}
