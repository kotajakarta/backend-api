import { PartialType } from '@nestjs/swagger';
import { CreateQuestionItemDto } from './create-question-item.dto.js';

export class UpdateQuestionItemDto extends PartialType(CreateQuestionItemDto) {}
