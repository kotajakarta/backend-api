import { IsNotEmpty, IsOptional, IsString, IsInt, Min, IsBoolean } from 'class-validator';

export class CreateQuestionBankDto {
  @IsNotEmpty({ message: 'Judul paket bank soal wajib diisi' })
  @IsString()
  title!: string;

  @IsNotEmpty({ message: 'Mata pelajaran wajib diisi' })
  @IsString()
  subject!: string;

  @IsNotEmpty({ message: 'Tingkat/Kelas wajib diisi' })
  @IsString()
  gradeLevel!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  timeLimit?: number;

  @IsOptional()
  @IsString()
  institution?: string;

  @IsOptional()
  @IsString()
  academicYear?: string;

  @IsOptional()
  @IsString()
  semester?: string;

  @IsOptional()
  @IsString()
  instructions?: string;

  @IsOptional()
  @IsBoolean()
  isShared?: boolean;
}
