import { IsArray, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ConfirmLjkDto } from './confirm-ljk.dto.js';

export class ConfirmBulkLjkDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConfirmLjkDto)
  items!: ConfirmLjkDto[];
}
