import { IsString, IsNotEmpty, IsEnum, IsOptional, MinLength } from 'class-validator';
import { UserScope, UserDivisi } from '@prisma/client';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  password!: string;

  @IsEnum(UserScope)
  @IsNotEmpty()
  scope!: UserScope;

  @IsEnum(UserDivisi)
  @IsNotEmpty()
  divisi!: UserDivisi;

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
