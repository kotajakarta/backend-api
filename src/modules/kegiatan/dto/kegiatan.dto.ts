import { IsString, IsNotEmpty, IsDateString, IsOptional } from 'class-validator';

export class CreateJenisKegiatanDto {
  @IsString()
  @IsNotEmpty()
  nama!: string;
}

export class UpdateJenisKegiatanDto {
  @IsString()
  @IsNotEmpty()
  nama!: string;
}

export class CreateTemplateKegiatanDto {
  @IsString()
  @IsNotEmpty()
  judul!: string;

  @IsString()
  @IsNotEmpty()
  deskripsi!: string;

  @IsDateString()
  @IsNotEmpty()
  deadline!: string;

  @IsString()
  @IsNotEmpty()
  jenisId!: string;
}

export class UpdateTemplateKegiatanDto {
  @IsString()
  @IsOptional()
  judul?: string;

  @IsString()
  @IsOptional()
  deskripsi?: string;

  @IsDateString()
  @IsOptional()
  deadline?: string;

  @IsString()
  @IsOptional()
  jenisId?: string;
}

export class CreateKegiatanDto {
  @IsString()
  @IsNotEmpty()
  templateId!: string;

  @IsString()
  @IsNotEmpty()
  deskripsi!: string;

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
  deskripsi?: string;

  @IsString()
  @IsOptional()
  ketuaPanitiaId?: string;

  @IsString()
  @IsOptional()
  asramaId?: string;
}
