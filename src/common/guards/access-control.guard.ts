import { Injectable, CanActivate, ExecutionContext, ForbiddenException, UnauthorizedException, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service.js';
import { extractTokenFromCookieHeader } from '../utils/cookie-token.js';
import { assertModuleEnabled } from '../utils/module-guard.js';

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
    } else {
      const allowCookieAuth = this.reflector.getAllAndOverride<boolean>('allowCookieAuth', [
        context.getHandler(),
        context.getClass(),
      ]);
      if (allowCookieAuth) {
        if (req.headers.cookie) {
          token = extractTokenFromCookieHeader(req.headers.cookie);
        }
        if (!token && req.query) {
          const qToken = req.query.token || req.query.t;
          if (typeof qToken === 'string' && qToken.trim() !== '') {
            token = qToken.trim();
          }
        }
      }
    }

    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET as string, {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      }) as any;
      
      const user = await this.prisma.user.findUnique({ 
        where: { id: payload.id },
        include: { staff: true, cabang: true, wilayah: true }
      });
      if (!user) {
        throw new UnauthorizedException('Session invalid');
      }

      req.user = {
        ...payload,
        scope: user.scope || payload.scope,
        divisi: user.divisi || payload.divisi,
        staffId: user.staffId || payload.staffId || null,
        cabangId: user.cabangId || user.staff?.cabangId || payload.cabangId || null,
        wilayahId: user.wilayahId || user.staff?.wilayahId || payload.wilayahId || null,
        operatorName: user.operatorName || user.staff?.name || payload.operatorName || null,
      };

      const VALID_SCOPES = ['GLOBAL', 'WILAYAH', 'CABANG', 'WALI_KELAS', 'GURU', 'WALI', 'AUDITOR'];
      if (!VALID_SCOPES.includes(req.user.scope)) {
        throw new ForbiddenException(`Akses ditolak: Scope pengguna (${req.user.scope}) tidak valid atau tidak dikenali oleh sistem.`);
      }

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

      // AUDITOR enforcement: AUDITOR is strictly read-only for write operations (POST, PUT, PATCH, DELETE)
      const httpMethod = req.method?.toUpperCase();
      if (payload.scope === 'AUDITOR' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(httpMethod)) {
        if (!req.url.includes('/auth/logout')) {
          throw new ForbiddenException('Role AUDITOR hanya memiliki akses Baca (Read-Only). Anda tidak diizinkan membuat, mengubah, atau menghapus data.');
        }
      }

      // WALI tokens may only ever reach routes explicitly opted into WALI via @RequireScope('WALI').
      if (payload.scope === 'WALI') {
        if (requiredScope !== 'WALI') {
          throw new ForbiddenException('Akun wali santri tidak memiliki akses ke endpoint ini');
        }
        assertModuleEnabled('portalWalsanEnabled', 'Modul Portal Wali Santri sedang dinonaktifkan oleh Administrator Pusat.');
      }

      // Protection for GURU & WALI_KELAS from sensitive financial, mutation, and admin settings routes
      if (payload.scope === 'GURU' || payload.scope === 'WALI_KELAS') {
        const url = req.originalUrl || req.url || '';
        // Block mutasi / tarik data siswa
        if (url.includes('/permintaan-tarik') || url.includes('/tarik-massal')) {
          throw new ForbiddenException('Akses ditolak: Akun Guru/Wali Kelas tidak memiliki izin permohonan mutasi/tarik data santri');
        }
        // Block data keuangan syahriyah & pembayaran
        if (url.includes('/syahriyah') || url.includes('/pembayaran')) {
          throw new ForbiddenException('Akses ditolak: Data keuangan dan syahriyah dilindungi dan tidak dapat diakses oleh akun Guru/Wali Kelas');
        }
        // Block pengaturan master sistem & sync
        if (url.includes('/pengaturan') || url.includes('/sync') || url.includes('/admin/users')) {
          throw new ForbiddenException('Akses ditolak: Akun Guru/Wali Kelas tidak memiliki izin ke menu konfigurasi sistem');
        }
        // Block mutasi staff kepegawaian (POST/PUT/DELETE /staff)
        if (url.includes('/staff') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(httpMethod)) {
          throw new ForbiddenException('Akses ditolak: Pengelolaan data staf hanya dapat dilakukan oleh Admin/Operator Cabang');
        }
      }

      if (requiredScope) {
        if (requiredScope === 'WALI') {
          if (payload.scope !== 'WALI') throw new ForbiddenException('Endpoint khusus portal wali santri');
        } else if (requiredScope === 'GLOBAL') {
          if (payload.scope !== 'GLOBAL' && payload.scope !== 'AUDITOR') throw new ForbiddenException('Requires GLOBAL scope');
        } else if (requiredScope === 'WILAYAH') {
          if (payload.scope !== 'GLOBAL' && payload.scope !== 'WILAYAH' && payload.scope !== 'AUDITOR') throw new ForbiddenException('Requires WILAYAH scope');
        } else if (requiredScope === 'CABANG') {
          if (!['GLOBAL', 'WILAYAH', 'CABANG', 'AUDITOR'].includes(payload.scope)) throw new ForbiddenException('Requires CABANG scope');
        } else if (requiredScope === 'WALI_KELAS') {
          if (!['GLOBAL', 'WILAYAH', 'CABANG', 'WALI_KELAS', 'AUDITOR'].includes(payload.scope)) throw new ForbiddenException('Requires WALI_KELAS scope');
        } else if (requiredScope === 'GURU') {
          if (!['GLOBAL', 'WILAYAH', 'CABANG', 'WALI_KELAS', 'GURU', 'AUDITOR'].includes(payload.scope)) throw new ForbiddenException('Requires GURU scope');
        }
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
