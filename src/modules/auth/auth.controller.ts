import { Controller, Post, Body, Get, UseGuards, Request, Inject } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';
import { RequireDivisi } from '../../common/decorators/access-control.decorator.js';
import { LoginDto } from './login.dto.js';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.username, dto.password);
  }

  @Get('protected-formal')
  @UseGuards(AccessControlGuard)
  @RequireDivisi('FORMAL')
  getProtectedFormal(@Request() req: any) {
    return { message: 'Welcome to formal division data', user: req.user };
  }
}
