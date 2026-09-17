import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateQuestionItemDto } from './create-question-item.dto.js';

export class BatchCreateQuestionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateQuestionItemDto)
  questions!: CreateQuestionItemDto[];
}
