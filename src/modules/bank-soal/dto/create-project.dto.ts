import { IsNotEmpty, IsOptional, IsString, IsArray, ValidateNested, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAssignmentItemDto {
  @IsOptional()
  @IsString()
  subjectId?: string;

  @IsNotEmpty({ message: 'Nama mata pelajaran wajib diisi' })
  @IsString()
  subjectName!: string;

  @IsNotEmpty({ message: 'Tingkat/Kelas wajib diisi' })
  @IsString()
  gradeLevel!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  targetMcqCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  targetEssayCount?: number;

  @IsOptional()
  @IsInt()
  timeLimit?: number;

  @IsOptional()
  @IsString()
  instructions?: string;

  @IsOptional()
  @IsString()
  wilayahId?: string;

  @IsOptional()
  @IsString()
  cabangId?: string;

  @IsOptional()
  @IsString()
  teacherId?: string;
}

export class CreateProjectDto {
  @IsNotEmpty({ message: 'Judul proyek penugasan wajib diisi' })
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  academicYear?: string;

  @IsOptional()
  @IsString()
  semester?: string;

  @IsOptional()
  @IsString()
  deadline?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAssignmentItemDto)
  assignments?: CreateAssignmentItemDto[];
}
