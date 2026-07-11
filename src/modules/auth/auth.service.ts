import { Injectable, UnauthorizedException, Inject, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
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
    const user = await this.prisma.user.findUnique({ 
      where: { username },
      include: {
        wilayah: true,
        cabang: true
      }
    });
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
      username: user.username,
      operatorName: user.operatorName || null,
      scope: user.scope,
      divisi: user.divisi,
      wilayahId: user.wilayahId,
      cabangId: user.cabangId,
      wilayahName: user.wilayah?.name || null,
      cabangName: user.cabang?.name || null,
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

  async updateProfile(userId: string, data: any, isGlobalAdmin: boolean) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        wilayah: true,
        cabang: true
      }
    });
    if (!user) throw new NotFoundException('User tidak ditemukan');

    const updateData: any = {};

    if (data.operatorName !== undefined) {
      updateData.operatorName = data.operatorName || null;
    }

    if (data.password) {
      updateData.password = await bcrypt.hash(data.password, 10);
    }

    if (data.username && data.username !== user.username) {
      if (!isGlobalAdmin) {
        throw new ForbiddenException('Hanya Administrator yang dapat mengubah username');
      }
      const existing = await this.prisma.user.findUnique({
        where: { username: data.username }
      });
      if (existing) {
        throw new BadRequestException('Username sudah digunakan');
      }
      updateData.username = data.username;
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      include: {
        wilayah: true,
        cabang: true
      }
    });

    const payload = {
      id: updatedUser.id,
      username: updatedUser.username,
      operatorName: updatedUser.operatorName || null,
      scope: updatedUser.scope,
      divisi: updatedUser.divisi,
      wilayahId: updatedUser.wilayahId,
      cabangId: updatedUser.cabangId,
      wilayahName: updatedUser.wilayah?.name || null,
      cabangName: updatedUser.cabang?.name || null,
    };

    const token = jwt.sign(payload, JWT_SECRET as string, {
      expiresIn: '8h',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    return {
      token,
      user: payload
    };
  }
}
