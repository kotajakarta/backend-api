import { IsString, IsNotEmpty, IsEnum, IsOptional, MinLength } from 'class-validator';
import { UserScope, UserDivisi } from '@prisma/client';

export class UpdateUserDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  username?: string;

  @IsString()
  @IsOptional()
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  password?: string;

  @IsEnum(UserScope)
  @IsNotEmpty()
  @IsOptional()
  scope?: UserScope;

  @IsEnum(UserDivisi)
  @IsNotEmpty()
  @IsOptional()
  divisi?: UserDivisi;

  @IsString()
  @IsOptional()
  operatorName?: string;

  @IsString()
  @IsOptional()
  wilayahId?: string;

  @IsString()
  @IsOptional()
  cabangId?: string;
}
