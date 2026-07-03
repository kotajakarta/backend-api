import { IsString, IsNotEmpty, MaxLength, MinLength } from 'class-validator';

/**
 * Login Data Transfer Object.
 * Validates and sanitizes login input before it reaches the auth service.
 * Prevents injection attacks and malformed payloads.
 */
export class LoginDto {
  @IsString()
  @IsNotEmpty({ message: 'Username is required' })
  @MaxLength(50, { message: 'Username must not exceed 50 characters' })
  username!: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  @MaxLength(128, { message: 'Password must not exceed 128 characters' })
  password!: string;
}
