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

  @Get('auth/2fa/status')
  @UseGuards(AccessControlGuard)
  async get2FAStatus(@Request() req: any) {
    return this.authService.get2FAStatus(req.user.id);
  }

  @Post('auth/2fa/generate')
  @UseGuards(AccessControlGuard)
  async generate2FASecret(@Request() req: any) {
    return this.authService.generate2FASecret(req.user.id);
  }

  @Post('auth/2fa/enable')
  @UseGuards(AccessControlGuard)
  async enable2FA(@Request() req: any, @Body() body: { secret: string; code: string }) {
    return this.authService.enable2FA(req.user.id, body.secret, body.code);
  }

  @Post('auth/2fa/disable')
  @UseGuards(AccessControlGuard)
  async disable2FA(@Request() req: any, @Body() body: { code?: string }) {
    return this.authService.disable2FA(req.user.id, body.code);
  }

  @Post('auth/2fa/verify-login')
  async verify2FALogin(@Body() body: { tempToken: string; code: string }) {
    return this.authService.verify2FALogin(body.tempToken, body.code);
  }

  @Get('auth/protected-formal')
  @UseGuards(AccessControlGuard)
  @RequireDivisi('FORMAL')
  getProtectedFormal(@Request() req: any) {
    return { message: 'Welcome to formal division data', user: req.user };
  }
}
