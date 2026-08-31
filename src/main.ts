import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { PrismaClientExceptionFilter } from './common/filters/prisma-client-exception.filter.js';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor.js';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { ExpressAdapter } from '@nestjs/platform-express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { requestIdMiddleware } from './common/middleware/request-id.middleware.js';
import { loginRateLimiter, globalRateLimiter, daftarUlangRateLimiter, setRateLimitRedisClient } from './common/middleware/rate-limit.middleware.js';
import { createUploadAuthMiddleware } from './common/middleware/upload-auth.middleware.js';
import { RedisService } from './common/redis/redis.service.js';
import { MinioService } from './common/minio/minio.service.js';
import { sanitizeTurkishDeep } from './common/utils/turkish-char.util.js';

async function bootstrap() {
  const server = express();
  
  // Enable reverse proxy support (Cloudflare / Nginx / Podman network)
  server.set('trust proxy', 1);

  // HTTP Response Compression (Gzip/Deflate)
  server.use(compression());

  // ════════════════════════════════════════════════════════════════
  //  LAYER 1: Security Headers (Helmet)
  //  Sets X-Frame-Options, X-Content-Type-Options, HSTS,
  //  Referrer-Policy, CSP, and removes X-Powered-By header.
  // ════════════════════════════════════════════════════════════════
  server.use(helmet({
    contentSecurityPolicy: false, // Disabled to allow Swagger UI assets
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    xFrameOptions: false,
  }));

  // ════════════════════════════════════════════════════════════════
  //  LAYER 2: Request ID Tracing
  //  Assigns a unique UUID to every request for end-to-end tracing.
  // ════════════════════════════════════════════════════════════════
  server.use(requestIdMiddleware);

  // ════════════════════════════════════════════════════════════════
  //  LAYER 3: CORS (Cross-Origin Resource Sharing)
  //  Only allows requests from whitelisted frontend domains.
  // ════════════════════════════════════════════════════════════════
  let corsOptions: cors.CorsOptions = { origin: false }; // Default: deny all
  if (process.env.CORS_ORIGINS) {
    if (process.env.CORS_ORIGINS === '*') {
      // Reflecting any Origin (`origin: true`) together with `credentials: true` is
      // equivalent to an unrestricted wildcard-with-credentials policy — any site could
      // make credentialed requests using a visitor's `token` cookie. Never combine the two.
      corsOptions = { origin: true, credentials: false };
      console.warn('⚠️  CORS_ORIGINS=* — credentialed cross-origin requests are disabled for safety. Set explicit origins in CORS_ORIGINS to allow cookies/Authorization from a browser.');
    } else {
      const origins = process.env.CORS_ORIGINS.split(',').map(o => o.trim());
      corsOptions = { origin: origins, credentials: true };
    }
  }
  server.use(cors(corsOptions));

  // ════════════════════════════════════════════════════════════════
  //  LAYER 4: Rate Limiting
  //  Login: 5 attempts/min per IP. General: 100 requests/min per IP.
  // ════════════════════════════════════════════════════════════════
  const apiPrefix = process.env.API_PREFIX || 'api/v1';
  server.use(`/${apiPrefix}/auth/login`, loginRateLimiter);
  server.use(`/${apiPrefix}/signin`, loginRateLimiter);
  server.use(`/${apiPrefix}/students/daftar-ulang/verify`, daftarUlangRateLimiter);
  server.use(`/${apiPrefix}/students/daftar-ulang/submit`, daftarUlangRateLimiter);
  server.use(`/${apiPrefix}/pengaturan/cctv/verify-pin`, loginRateLimiter);
  server.use(`/${apiPrefix}/auth/2fa/verify-login`, loginRateLimiter);
  server.use(`/${apiPrefix}`, globalRateLimiter);

  // ════════════════════════════════════════════════════════════════
  //  LAYER 5: Body Parsing & Static Uploads Serving
  // ════════════════════════════════════════════════════════════════
  server.use(express.json({ limit: '10mb' }));
  server.use(express.urlencoded({ limit: '10mb', extended: true }));

  // ════════════════════════════════════════════════════════════════
  //  LAYER 5.1: Turkish Character Normalization Middleware
  //  Normalizes Turkish characters (İ->I, Ü->U, Ö->O, Ş->S, etc.) on all inputs
  // ════════════════════════════════════════════════════════════════
  server.use((req, _res, next) => {
    try {
      if (req.body && typeof req.body === 'object') {
        for (const key of Object.keys(req.body)) {
          req.body[key] = sanitizeTurkishDeep(req.body[key]);
        }
      }
      if (req.query && typeof req.query === 'object') {
        for (const key of Object.keys(req.query)) {
          (req.query as any)[key] = sanitizeTurkishDeep((req.query as any)[key]);
        }
      }
    } catch {
      // safe fallback
    }
    next();
  });

  // Static uploads directory serving with JWT auth protection (MinIO Stream + Fallback)
  let nestAppInstance: INestApplication | null = null;
  const uploadAuthMiddleware = createUploadAuthMiddleware(() => nestAppInstance);

  const uploadDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const uploadServeHandler = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      const app = nestAppInstance;
      let reqPath = req.path;
      if (reqPath.startsWith('/')) reqPath = reqPath.slice(1);

      if (!app || !reqPath) {
        return next();
      }

      const minioService = app.get(MinioService);
      const stat = await minioService.statObject(reqPath);

      if (stat) {
        const stream = await minioService.getObjectStream(reqPath);
        const mimeType = minioService.getMimeType(reqPath);
        const filename = path.basename(reqPath);

        res.removeHeader('X-Frame-Options');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Length', stat.size);
        res.setHeader('ETag', stat.etag);
        res.setHeader('Last-Modified', stat.lastModified.toUTCString());
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

        stream.pipe(res);
        return;
      }

      // Fallback: File lokal jika belum termigrasi
      const localFilePath = path.join(uploadDir, reqPath);
      if (fs.existsSync(localFilePath) && fs.statSync(localFilePath).isFile()) {
        res.removeHeader('X-Frame-Options');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        return res.sendFile(localFilePath);
      }

      return res.status(404).json({ status: false, message: 'File tidak ditemukan' });
    } catch (err: any) {
      const localFilePath = path.join(uploadDir, req.path.startsWith('/') ? req.path.slice(1) : req.path);
      if (fs.existsSync(localFilePath) && fs.statSync(localFilePath).isFile()) {
        res.removeHeader('X-Frame-Options');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        return res.sendFile(localFilePath);
      }
      return res.status(404).json({ status: false, message: 'File tidak ditemukan' });
    }
  };

  server.use('/uploads', uploadAuthMiddleware, uploadServeHandler);
  server.use(`/${apiPrefix}/uploads`, uploadAuthMiddleware, uploadServeHandler);
  server.use(`/${apiPrefix}/pengaturan/uploads`, uploadAuthMiddleware, uploadServeHandler);


  // ════════════════════════════════════════════════════════════════
  //  NestJS Application Bootstrap
  // ════════════════════════════════════════════════════════════════
  const nestApp = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    bodyParser: false,
    logger: ['error', 'warn', 'log'],
  });
  nestAppInstance = nestApp;

  // Hubungkan middleware rate limit ke client Redis
  const redisService = nestApp.get(RedisService);
  setRateLimitRedisClient(redisService.getClient());

  nestApp.setGlobalPrefix(apiPrefix);

  // ════════════════════════════════════════════════════════════════
  //  LAYER 6: Input Validation (Global Pipe)
  //  Strips unknown properties and transforms input types.
  // ════════════════════════════════════════════════════════════════
  nestApp.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true, // Reject payloads with unknown fields
    transform: true,
  }));

  // ════════════════════════════════════════════════════════════════
  //  LAYER 7: Audit Logging (Global Interceptor)
  //  Logs all POST/PUT/DELETE operations with user identity.
  // ════════════════════════════════════════════════════════════════
  nestApp.useGlobalInterceptors(new AuditLogInterceptor());

  // ════════════════════════════════════════════════════════════════
  //  LAYER 8: Error Masking (Global Filters)
  //  Prevents internal details from leaking to clients.
  //  Order matters: Prisma filter first (specific), Global filter last (catch-all).
  // ════════════════════════════════════════════════════════════════
  nestApp.useGlobalFilters(
    new GlobalExceptionFilter(),
    new PrismaClientExceptionFilter(),
  );

  // ════════════════════════════════════════════════════════════════
  //  Swagger Documentation
  //  Can be explicitly enabled/disabled via ENABLE_SWAGGER in .env
  //  Defaults to enabled in development, disabled in production.
  // ════════════════════════════════════════════════════════════════
  const isProduction = process.env.NODE_ENV === 'production';
  const enableSwagger = process.env.ENABLE_SWAGGER 
    ? process.env.ENABLE_SWAGGER === 'true'
    : !isProduction;

  if (enableSwagger) {
    const config = new DocumentBuilder()
      .setTitle('Edaimi Backend API')
      .setDescription(
        'API Gateway Terpusat untuk semua aplikasi Edaimi (Sekolah App, Pesantren App, dll). ' +
        'Semua akses database disentralisasi melalui API ini.'
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(nestApp, config);
    SwaggerModule.setup(`${apiPrefix}/docs`, nestApp, document);
  }

  const port = process.env.PORT || 8080;
  await nestApp.listen(port, '0.0.0.0');

  console.log(`🚀 Backend API Gateway is running on http://0.0.0.0:${port}`);
  console.log(`🛡️  Security: Helmet, Rate Limiting, CORS, Audit Logging — ACTIVE`);
  if (enableSwagger) {
    console.log(`📖 Swagger Docs: http://localhost:${port}/${apiPrefix}/docs`);
  }
  console.log(`❤️  Health Check: http://localhost:${port}/${apiPrefix}/health`);
}

bootstrap();
// Pesantren External API Module loaded

