import { Controller, Post, Body, Get, Put, UseGuards, Request, Inject } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';
import { RequireDivisi } from '../../common/decorators/access-control.decorator.js';
import { LoginDto } from './login.dto.js';

@Controller()
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('auth/login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.username, dto.password);
  }

  // Alias endpoint — avoids adblocker rules that block "auth/login" patterns
  @Post('signin')
  async signin(@Body() dto: LoginDto) {
    return this.authService.login(dto.username, dto.password);
  }

  @Put('auth/profile')
  @UseGuards(AccessControlGuard)
  async updateProfile(@Request() req: any, @Body() body: any) {
    return this.authService.updateProfile(req.user.id, body, req.user.scope === 'GLOBAL');
  }

  @Get('auth/protected-formal')
  @UseGuards(AccessControlGuard)
  @RequireDivisi('FORMAL')
  getProtectedFormal(@Request() req: any) {
    return { message: 'Welcome to formal division data', user: req.user };
  }
}
