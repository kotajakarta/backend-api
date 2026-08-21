import { IsArray, IsNotEmpty, IsString } from 'class-validator';

export class ReorderQuestionsDto {
  @IsArray()
  @IsNotEmpty({ each: true })
  @IsString({ each: true })
  questionIds!: string[];
}
