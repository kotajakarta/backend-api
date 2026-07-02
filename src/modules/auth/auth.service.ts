import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { PrismaService } from '../../common/prisma/prisma.service.js';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-pusdatin-key';

@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}


  async login(username: string, passwordPlain: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) {
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

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1d' });

    return {
      token,
      user: payload,
    };
  }
}
