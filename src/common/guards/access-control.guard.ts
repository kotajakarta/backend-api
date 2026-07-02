import { Injectable, CanActivate, ExecutionContext, ForbiddenException, UnauthorizedException, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service.js';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-pusdatin-key';

@Injectable()
export class AccessControlGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private reflector: Reflector,
    @Inject(PrismaService) private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('No token provided');
    }

    const token = authHeader.split(' ')[1];

    try {
      const payload = jwt.verify(token, JWT_SECRET) as any;
      
      const user = await this.prisma.user.findUnique({ where: { id: payload.id } });
      if (!user) {
        throw new UnauthorizedException('Session invalid');
      }

      req.user = payload;

      const requiredDivisi = this.reflector.get<string>('requireDivisi', context.getHandler());
      const requiredScope = this.reflector.get<string>('requireScope', context.getHandler());

      if (requiredDivisi) {
        if (payload.divisi !== requiredDivisi && payload.divisi !== 'ALL') {
          throw new ForbiddenException('Insufficient Divisi access');
        }
      }

      if (requiredScope) {
        if (requiredScope === 'GLOBAL' && payload.scope !== 'GLOBAL') {
          throw new ForbiddenException('Requires GLOBAL scope');
        }
        if (requiredScope === 'WILAYAH' && payload.scope !== 'GLOBAL' && payload.scope !== 'WILAYAH') {
          throw new ForbiddenException('Requires WILAYAH scope');
        }
      }

      return true;
    } catch (error: any) {
      console.error('AccessControlGuard error:', error.message || error);
      if (error instanceof ForbiddenException || error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid token');
    }
  }
}

