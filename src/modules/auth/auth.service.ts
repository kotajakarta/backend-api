import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { PrismaService } from '../../common/prisma/prisma.service.js';

/**
 * JWT Security Hardening:
 * - No fallback secret — application MUST fail to start if JWT_SECRET is missing.
 * - Issuer (iss) and Audience (aud) claims for token binding.
 * - Short-lived tokens (8 hours) to minimize exposure window.
 */
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
}

const JWT_ISSUER = 'edaimi-backend-api';
const JWT_AUDIENCE = 'edaimi-clients';

@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async login(username: string, passwordPlain: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) {
      // Use identical error message for both cases to prevent username enumeration
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(passwordPlain, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = {
      id: user.id,
      scope: user.scope,
      divisi: user.divisi,
      wilayahId: user.wilayahId,
      cabangId: user.cabangId,
    };

    const token = jwt.sign(payload, JWT_SECRET as string, {
      expiresIn: '8h',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    return {
      token,
      user: payload,
    };
  }
}
