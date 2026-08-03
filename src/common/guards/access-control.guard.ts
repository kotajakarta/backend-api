import { Injectable, CanActivate, ExecutionContext, ForbiddenException, UnauthorizedException, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Enterprise Access Control Guard.
 * - Validates JWT token with issuer/audience verification.
 * - Checks user existence in database (session validity).
 * - Enforces role-based access control (Scope + Divisi).
 * - No fallback secret — fails safely if JWT_SECRET is missing.
 */
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
}

const JWT_ISSUER = 'edaimi-backend-api';
const JWT_AUDIENCE = 'edaimi-clients';

@Injectable()
export class AccessControlGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private reflector: Reflector,
    @Inject(PrismaService) private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    let token: string | null = null;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.query && typeof req.query.token === 'string') {
      token = req.query.token;
    }

    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET as string, {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      }) as any;
      
      const user = await this.prisma.user.findUnique({ where: { id: payload.id } });
      if (!user) {
        throw new UnauthorizedException('Session invalid');
      }

      req.user = payload;

      const requiredDivisi = this.reflector.getAllAndOverride<string>('requireDivisi', [
        context.getHandler(),
        context.getClass(),
      ]);
      const requiredScope = this.reflector.getAllAndOverride<string>('requireScope', [
        context.getHandler(),
        context.getClass(),
      ]);

      if (requiredDivisi && payload.scope !== 'WALI') {
        if (payload.divisi !== requiredDivisi && payload.divisi !== 'ALL') {
          throw new ForbiddenException('Insufficient Divisi access');
        }
      }

      if (requiredScope) {
        if (requiredScope === 'WALI') {
          if (payload.scope !== 'WALI') throw new ForbiddenException('Endpoint khusus portal wali santri');
        } else if (requiredScope === 'GLOBAL') {
          if (payload.scope !== 'GLOBAL') throw new ForbiddenException('Requires GLOBAL scope');
        } else if (requiredScope === 'WILAYAH') {
          if (payload.scope !== 'GLOBAL' && payload.scope !== 'WILAYAH') throw new ForbiddenException('Requires WILAYAH scope');
        }
        // 'CABANG' branch intentionally left as a pre-existing no-op — out of scope for this task,
        // do not add CABANG-hierarchy enforcement here, that's a separate pre-existing gap.
      }

      // WALI tokens may only ever reach routes explicitly opted into WALI via @RequireScope('WALI').
      if (payload.scope === 'WALI' && requiredScope !== 'WALI') {
        throw new ForbiddenException('Akun wali santri tidak memiliki akses ke endpoint ini');
      }

      return true;
    } catch (error: any) {
      // Log the error internally with request ID for tracing
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'AUTH_ERROR',
        requestId: req.requestId || 'N/A',
        ip: req.ip || req.socket?.remoteAddress || 'unknown',
        error: error.message || 'Unknown auth error',
      }));

      if (error instanceof ForbiddenException || error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
