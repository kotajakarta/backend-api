import { IsOptional, IsString, IsInt, Min, IsEnum } from 'class-validator';
import { AssignmentStatus } from '@prisma/client';

export class UpdateAssignmentDto {
  @IsOptional()
  @IsString()
  subjectId?: string;

  @IsOptional()
  @IsString()
  subjectName?: string;

  @IsOptional()
  @IsString()
  gradeLevel?: string;

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

  @IsOptional()
  @IsEnum(AssignmentStatus)
  status?: AssignmentStatus;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  questionBankId?: string;
}

export class ReviewAssignmentDto {
  @IsString()
  action!: 'APPROVE' | 'REVISE';

  @IsOptional()
  @IsString()
  notes?: string;
}
