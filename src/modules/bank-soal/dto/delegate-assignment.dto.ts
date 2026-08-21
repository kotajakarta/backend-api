import { IsOptional, IsString, IsEnum } from 'class-validator';
import { AssignmentStatus } from '@prisma/client';

export class DelegateAssignmentDto {
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
