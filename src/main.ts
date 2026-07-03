import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { PrismaClientExceptionFilter } from './common/filters/prisma-client-exception.filter.js';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor.js';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import express from 'express';
import { ExpressAdapter } from '@nestjs/platform-express';
import cors from 'cors';
import helmet from 'helmet';
import { requestIdMiddleware } from './common/middleware/request-id.middleware.js';
import { loginRateLimiter, globalRateLimiter } from './common/middleware/rate-limit.middleware.js';

async function bootstrap() {
  const server = express();
  
  // ════════════════════════════════════════════════════════════════
  //  LAYER 1: Security Headers (Helmet)
  //  Sets X-Frame-Options, X-Content-Type-Options, HSTS,
  //  Referrer-Policy, CSP, and removes X-Powered-By header.
  // ════════════════════════════════════════════════════════════════
  server.use(helmet({
    contentSecurityPolicy: false, // Disabled to allow Swagger UI assets
    crossOriginEmbedderPolicy: false,
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
      corsOptions = { origin: true, credentials: true };
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
  server.use(`/${apiPrefix}`, globalRateLimiter);

  // ════════════════════════════════════════════════════════════════
  //  LAYER 5: Body Parsing with size limits
  // ════════════════════════════════════════════════════════════════
  server.use(express.json({ limit: '10mb' }));
  server.use(express.urlencoded({ limit: '10mb', extended: true }));

  // ════════════════════════════════════════════════════════════════
  //  NestJS Application Bootstrap
  // ════════════════════════════════════════════════════════════════
  const nestApp = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    bodyParser: false,
    logger: ['error', 'warn', 'log'],
  });

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
  //  Swagger Documentation (Development Only)
  //  In production, docs endpoint returns 404 to prevent API enumeration.
  // ════════════════════════════════════════════════════════════════
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
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
  if (!isProduction) {
    console.log(`📖 Swagger Docs: http://localhost:${port}/${apiPrefix}/docs`);
  }
  console.log(`❤️  Health Check: http://localhost:${port}/${apiPrefix}/health`);
}

bootstrap();
