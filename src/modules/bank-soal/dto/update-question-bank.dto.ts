import { PartialType } from '@nestjs/swagger';
import { CreateQuestionBankDto } from './create-question-bank.dto.js';

export class UpdateQuestionBankDto extends PartialType(CreateQuestionBankDto) {}
