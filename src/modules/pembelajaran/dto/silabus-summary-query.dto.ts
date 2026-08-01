import { IsString, IsNotEmpty } from 'class-validator';

export class SilabusSummaryQueryDto {
  @IsString()
  @IsNotEmpty()
  tingkat!: string;

  @IsString()
  @IsNotEmpty()
  tahunAjaran!: string;

  @IsString()
  @IsNotEmpty()
  semester!: string;
}
