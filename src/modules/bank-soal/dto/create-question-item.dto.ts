import { IsEnum, IsNotEmpty, IsOptional, IsString, IsArray, ValidateNested, IsBoolean, IsInt, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { QuestionType } from '@prisma/client';

export class QuestionOptionDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsNotEmpty()
  @IsString()
  label!: string; // 'A', 'B', 'C', 'D', 'E'

  @IsNotEmpty()
  @IsString()
  contentHtml!: string;

  @IsOptional()
  @IsBoolean()
  isCorrect?: boolean;

  @IsOptional()
  @IsInt()
  orderIndex?: number;
}

export class CreateQuestionItemDto {
  @IsEnum(QuestionType, { message: 'Tipe soal tidak valid' })
  type!: QuestionType;

  @IsNotEmpty({ message: 'Isi pertanyaan wajib diisi' })
  @IsString()
  contentHtml!: string;

  @IsOptional()
  @IsString()
  answerKey?: string;

  @IsOptional()
  @IsNumber()
  weight?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options?: QuestionOptionDto[];
}
