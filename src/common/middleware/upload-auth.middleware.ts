import express from 'express';
import jwt from 'jsonwebtoken';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export function createUploadAuthMiddleware(getNestApp: () => INestApplication | null) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    let token: string | null = null;

    // 1. Cek dari header Authorization (Bearer token)
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }
    // 2. Cek dari query parameter ?token=
    else if (req.query && typeof req.query.token === 'string') {
      token = req.query.token;
    }
    // 3. Cek dari cookies (token=...)
    else if (req.headers.cookie) {
      const cookies = req.headers.cookie.split(';').reduce((acc: Record<string, string>, item: string) => {
        const parts = item.split('=');
        if (parts.length >= 2) {
          acc[parts[0].trim()] = parts.slice(1).join('=').trim();
        }
        return acc;
      }, {});
      if (cookies.token) {
        token = cookies.token;
      }
    }

    if (!token) {
      return res.status(401).json({
        status: false,
        message: 'Akses ditolak: Anda harus login untuk mengakses file/dokumen ini'
      });
    }

    const JWT_SECRET = process.env.JWT_SECRET;
    if (!JWT_SECRET) {
      return res.status(500).json({ status: false, message: 'Server configuration error' });
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET, {
        issuer: 'edaimi-backend-api',
        audience: 'edaimi-clients',
      }) as any;

      const app = getNestApp();
      if (app) {
        const prisma = app.get(PrismaService);
        const user = await prisma.user.findUnique({ where: { id: payload.id } });
        if (!user) {
          return res.status(401).json({
            status: false,
            message: 'Akses ditolak: Sesi tidak valid atau pengguna tidak ditemukan'
          });
        }
      }

      (req as any).user = payload;
      return next();
    } catch (error) {
      return res.status(401).json({
        status: false,
        message: 'Akses ditolak: Token tidak valid atau kedaluwarsa'
      });
    }
  };
}
